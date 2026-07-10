import { describe, expect, it } from 'vitest';
import {
  buildPostingBodySimilarityFeedback,
  buildPostingTitleSimilarityFeedback,
  checkPostingSimilarity,
  isPostingSimilaritySkipError,
  isPostingSimilarityTooHigh,
  isPostingTitleSimilarityTooHigh,
  MAX_POSTING_BODY_SIMILARITY_RETRIES,
  POSTING_BODY_COMPARE_LIMIT,
  POSTING_SIMILARITY_THRESHOLD,
  POSTING_TITLE_RESERVED_STATUSES,
  POSTING_TITLE_SIMILARITY_THRESHOLD,
  PostingSimilaritySkipError,
} from './posting-content-similarity.js';
import { embedText } from '../modules/video-content/embedding.js';

describe('checkPostingSimilarity', () => {
  it('uses posting threshold constant', () => {
    expect(POSTING_TITLE_SIMILARITY_THRESHOLD).toBe(0.65);
    expect(POSTING_SIMILARITY_THRESHOLD).toBe(0.85);
    expect(POSTING_BODY_COMPARE_LIMIT).toBe(10);
    expect(MAX_POSTING_BODY_SIMILARITY_RETRIES).toBe(1);
    expect(POSTING_TITLE_RESERVED_STATUSES).toContain('scheduled');
    expect(POSTING_TITLE_RESERVED_STATUSES).toContain('completed');
  });

  it('passes at exactly threshold (초과만 실패)', () => {
    expect(isPostingTitleSimilarityTooHigh(0.65)).toBe(false);
    expect(isPostingTitleSimilarityTooHigh(0.650001)).toBe(true);
    expect(isPostingSimilarityTooHigh(0.85)).toBe(false);
    expect(isPostingSimilarityTooHigh(0.850001)).toBe(true);
  });

  it('fails on identical title', () => {
    const title = '사주 총정리 후기';
    const emb = embedText(title);
    const check = checkPostingSimilarity(title, '완전히 새로운 본문입니다.', {
      allTitleEmbeddings: [emb],
      recentBodyEmbeddings: [],
    });
    expect(check.titleSimilarity).toBeGreaterThanOrEqual(0.99);
    expect(check.titleTooSimilar).toBe(true);
    expect(check.ok).toBe(false);
  });

  it('fails on identical title from another account corpus entry', () => {
    const title = '이달 운세 7월 연운으로 확인해봤어요';
    const check = checkPostingSimilarity(title, '다른 계정 본문', {
      allTitleEmbeddings: [embedText(title)],
      recentBodyEmbeddings: [],
    });
    expect(check.titleTooSimilar).toBe(true);
    expect(check.ok).toBe(false);
  });

  it('flags identical body', () => {
    const body = '오늘 사주를 보고 느낀 점을 정리해봤어요. 생각보다 재미있었습니다.';
    const emb = embedText(body);
    const check = checkPostingSimilarity('새 제목', body, {
      allTitleEmbeddings: [],
      recentBodyEmbeddings: [emb],
    });
    expect(check.bodySimilarity).toBeGreaterThanOrEqual(0.99);
    expect(check.bodyTooSimilar).toBe(true);
    expect(check.ok).toBe(false);
  });

  it('builds separate title and body feedback', () => {
    const check = checkPostingSimilarity('제목', '본문', {
      allTitleEmbeddings: [embedText('제목')],
      recentBodyEmbeddings: [embedText('본문')],
    });
    expect(buildPostingTitleSimilarityFeedback(check)).toContain('seo_title');
    expect(buildPostingBodySimilarityFeedback(check)).toContain('blog_post');
  });

  it('identifies PostingSimilaritySkipError', () => {
    const check = checkPostingSimilarity('a', 'b', {
      allTitleEmbeddings: [],
      recentBodyEmbeddings: [],
    });
    const err = new PostingSimilaritySkipError('skip', check, 1, 'body');
    expect(isPostingSimilaritySkipError(err)).toBe(true);
    expect(err.bodyRegenerations).toBe(1);
    expect(isPostingSimilaritySkipError(new Error('x'))).toBe(false);
  });
});
