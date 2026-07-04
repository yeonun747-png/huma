import { describe, expect, it } from 'vitest';
import { countExternalLinks } from './blog-url.js';
import { parsePostContentStats } from './content-stats.js';

describe('countExternalLinks', () => {
  it('does not count workspace domain mentions without a URL', () => {
    expect(countExternalLinks('연운(yeonun.com)에서 확인하세요', null)).toBe(0);
    expect(countExternalLinks('myquizoasis.com 퀴즈', null)).toBe(0);
  });

  it('counts bare https URLs in content', () => {
    expect(countExternalLinks('참고: https://example.com/page', null)).toBe(1);
  });

  it('does not count link_url when passed separately (caller uses published body only)', () => {
    expect(countExternalLinks('', 'https://yeonun.com')).toBe(1);
    expect(countExternalLinks('', null)).toBe(0);
  });
});

describe('parsePostContentStats ext_link_count', () => {
  it('ignores job link_url that is stripped before publish', () => {
    const stats = parsePostContentStats('오늘의 운세를 정리했습니다.', {
      linkUrl: 'https://yeonun.com',
      workspace: 'yeonun',
    });
    expect(stats.ext_link_count).toBe(0);
  });

  it('strips all https URLs from published body (no ext links on live blog)', () => {
    const stats = parsePostContentStats('자세한 내용은 https://example.com/guide 를 참고하세요.', {
      linkUrl: 'https://yeonun.com',
      workspace: 'yeonun',
    });
    expect(stats.ext_link_count).toBe(0);
  });
});
