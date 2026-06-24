import { describe, expect, it } from 'vitest';
import { canonicalBlogPostUrl, postBelongsToBlog, postNoFromDbRow } from './blog-url.js';

describe('postBelongsToBlog', () => {
  it('matches PostView.naver?blogId= URLs', () => {
    const url = 'https://blog.naver.com/PostView.naver?blogId=yeonun1&logNo=2234567890';
    expect(postBelongsToBlog(url, 'yeonun1')).toBe(true);
  });

  it('matches canonical blog.naver.com/{blogId}/{postNo} URLs', () => {
    expect(postBelongsToBlog('https://blog.naver.com/yeonun1/2234567890', 'yeonun1')).toBe(true);
  });

  it('rejects other blogs', () => {
    expect(postBelongsToBlog('https://blog.naver.com/other/2234567890', 'yeonun1')).toBe(false);
  });
});

describe('postNoFromDbRow', () => {
  it('falls back to post_url when post_no column is empty', () => {
    expect(
      postNoFromDbRow({
        post_no: null,
        post_url: 'https://blog.naver.com/yeonun2/224212849946',
      }),
    ).toBe('224212849946');
  });

  it('prefers post_no column when set', () => {
    expect(
      postNoFromDbRow({
        post_no: '111',
        post_url: 'https://blog.naver.com/yeonun2/224212849946',
      }),
    ).toBe('111');
  });
});

describe('canonicalBlogPostUrl', () => {
  it('normalizes PostView URLs', () => {
    expect(
      canonicalBlogPostUrl('https://blog.naver.com/PostView.naver?blogId=yeonun1&logNo=2234567890'),
    ).toBe('https://blog.naver.com/yeonun1/2234567890');
  });
});
