import { describe, expect, it } from 'vitest';
import { findPostRankInHrefs, postNoFromBlogHref } from './exposure-rank.js';

describe('postNoFromBlogHref', () => {
  it('parses desktop and mobile blog URLs', () => {
    expect(postNoFromBlogHref('https://blog.naver.com/foo/224212849946')).toBe('224212849946');
    expect(postNoFromBlogHref('https://blog.naver.com/PostView.naver?blogId=foo&logNo=123456789')).toBe(
      '123456789',
    );
    expect(postNoFromBlogHref('https://m.blog.naver.com/foo/224212849946')).toBe('224212849946');
  });
});

describe('findPostRankInHrefs', () => {
  const hrefs = [
    'https://blog.naver.com/other/111111111111',
    'https://blog.naver.com/foo/222222222222',
    'https://blog.naver.com/foo/333333333333',
  ];

  it('matches exact postNo only', () => {
    expect(findPostRankInHrefs(hrefs, '333333333333')).toBe(3);
    expect(findPostRankInHrefs(hrefs, '222222222222')).toBe(2);
    expect(findPostRankInHrefs(hrefs, '999999999999')).toBeNull();
  });

  it('does not match same blog different post', () => {
    expect(findPostRankInHrefs(hrefs, '111111111111')).toBe(1);
    expect(findPostRankInHrefs(hrefs, '222222222222')).not.toBe(1);
  });
});
