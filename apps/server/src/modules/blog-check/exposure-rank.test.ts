import { describe, expect, it } from 'vitest';
import {
  blogIdFromBlogHref,
  findPostRankInHrefs,
  hrefMatchesBlogPost,
  postNoFromBlogHref,
} from './exposure-rank.js';

describe('postNoFromBlogHref', () => {
  it('parses desktop and mobile blog URLs', () => {
    expect(postNoFromBlogHref('https://blog.naver.com/foo/224212849946')).toBe('224212849946');
    expect(postNoFromBlogHref('https://blog.naver.com/PostView.naver?blogId=foo&logNo=123456789')).toBe(
      '123456789',
    );
    expect(postNoFromBlogHref('https://m.blog.naver.com/foo/224212849946')).toBe('224212849946');
  });

  it('parses naver search redirect URLs', () => {
    expect(
      postNoFromBlogHref(
        'https://search.naver.com/p/crd/rd?u=https%3A%2F%2Fblog.naver.com%2Fyeonun2%2F224212849946',
      ),
    ).toBe('224212849946');
  });
});

describe('blogIdFromBlogHref', () => {
  it('parses blog id from path and query', () => {
    expect(blogIdFromBlogHref('https://blog.naver.com/yeonun2/224212849946')).toBe('yeonun2');
    expect(blogIdFromBlogHref('https://blog.naver.com/PostView.naver?blogId=foo&logNo=1')).toBe('foo');
  });
});

describe('findPostRankInHrefs', () => {
  const hrefs = [
    'https://blog.naver.com/other/111111111111',
    'https://blog.naver.com/foo/222222222222',
    'https://blog.naver.com/foo/333333333333',
  ];

  it('matches exact blogId and postNo only', () => {
    expect(findPostRankInHrefs(hrefs, 'foo', '333333333333')).toBe(3);
    expect(findPostRankInHrefs(hrefs, 'foo', '222222222222')).toBe(2);
    expect(findPostRankInHrefs(hrefs, 'foo', '999999999999')).toBeNull();
  });

  it('ignores same postNo on a different blog', () => {
    expect(findPostRankInHrefs(hrefs, 'yeonun2', '111111111111')).toBeNull();
    expect(findPostRankInHrefs(hrefs, 'other', '111111111111')).toBe(1);
  });

  it('finds rank beyond page 1 for weak tier', () => {
    const long = Array.from({ length: 14 }, (_, i) => `https://blog.naver.com/other/${100000 + i}`);
    long.push('https://blog.naver.com/foo/999999999999');
    expect(findPostRankInHrefs(long, 'foo', '999999999999')).toBe(15);
  });
});

describe('hrefMatchesBlogPost', () => {
  it('requires both blogId and postNo', () => {
    const href = 'https://blog.naver.com/yeonun2/123456789';
    expect(hrefMatchesBlogPost(href, 'yeonun2', '123456789')).toBe(true);
    expect(hrefMatchesBlogPost(href, 'other', '123456789')).toBe(false);
  });
});
