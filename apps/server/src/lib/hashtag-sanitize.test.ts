import { describe, expect, it } from 'vitest';
import {
  isBannedHashtag,
  sanitizeHashtags,
  urlContextForHashtags,
} from './hashtag-sanitize.js';

describe('hashtag-sanitize', () => {
  it('bans loading/error tags', () => {
    expect(isBannedHashtag('로딩중')).toBe(true);
    expect(isBannedHashtag('웹페이지오류')).toBe(true);
    expect(isBannedHashtag('콘텐츠없음')).toBe(true);
    expect(isBannedHashtag('재로딩필요')).toBe(true);
    expect(isBannedHashtag('연운')).toBe(false);
    expect(isBannedHashtag('사주')).toBe(false);
  });

  it('filters banned tags from Claude output', () => {
    const out = sanitizeHashtags(
      ['연운', '로딩중', '사주', '웹페이지오류', '운세', '콘텐츠없음', '궁합'],
      'yeonun',
    );
    expect(out).toContain('연운');
    expect(out).toContain('사주');
    expect(out).not.toContain('로딩중');
    expect(out).not.toContain('웹페이지오류');
  });

  it('strips SPA noise from url context for hashtags', () => {
    const noisy = `[URL 페이지 요약]
로딩 중입니다. 웹페이지 오류. 콘텐츠 없음. 재로딩 필요.`;
    expect(urlContextForHashtags(noisy)).toBe('');

    const withProduct = `[연운 상품 정보]
상품명: 월운 사주
태그: 사주, 운세

[URL 페이지 요약]
로딩 중`;
    expect(urlContextForHashtags(withProduct)).toContain('월운 사주');
    expect(urlContextForHashtags(withProduct)).not.toContain('로딩');
  });
});
