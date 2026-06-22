import { describe, expect, it } from 'vitest';
import {
  checkPostingSimilarity,
  POSTING_BODY_COMPARE_LIMIT,
  POSTING_SIMILARITY_THRESHOLD,
} from './posting-content-similarity.js';
import { embedText } from '../modules/video-content/embedding.js';

describe('checkPostingSimilarity', () => {
  it('uses posting threshold constant', () => {
    expect(POSTING_SIMILARITY_THRESHOLD).toBe(0.85);
    expect(POSTING_BODY_COMPARE_LIMIT).toBe(10);
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
});
