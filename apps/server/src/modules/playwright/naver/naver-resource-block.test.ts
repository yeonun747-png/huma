import { describe, expect, it } from 'vitest';

import {
  isBlogEditorOrPublishContext,
  isLoginOrCaptchaUrl,
  shouldAbortNaverResource,
} from './naver-resource-block.js';

describe('isLoginOrCaptchaUrl', () => {
  it('matches nid login', () => {
    expect(isLoginOrCaptchaUrl('https://nid.naver.com/nidlogin.login')).toBe(true);
  });

  it('matches captcha path', () => {
    expect(isLoginOrCaptchaUrl('https://nid.naver.com/captcha?rand=abc')).toBe(true);
  });
});

describe('isBlogEditorOrPublishContext', () => {
  it('matches postwrite URL', () => {
    expect(isBlogEditorOrPublishContext('https://blog.naver.com/yeonun1/postwrite')).toBe(true);
  });

  it('matches editor referer', () => {
    expect(
      isBlogEditorOrPublishContext('https://ssl.pstatic.net/tv/editor.js', 'https://blog.naver.com/x/postwrite'),
    ).toBe(true);
  });
});

describe('shouldAbortNaverResource', () => {
  it('always blocks ad hosts', () => {
    expect(
      shouldAbortNaverResource('https://ader.naver.com/foo', 'script', 'workflow'),
    ).toBe(true);
  });

  it('allows captcha images on nid', () => {
    expect(
      shouldAbortNaverResource('https://nid.naver.com/captcha?rand=1', 'image', 'workflow'),
    ).toBe(false);
  });

  it('allows editor scripts', () => {
    expect(
      shouldAbortNaverResource(
        'https://ssl.pstatic.net/static/se/editor.js',
        'script',
        'workflow',
        'https://blog.naver.com/yeonun1/postwrite',
      ),
    ).toBe(false);
  });

  it('blocks naver home images', () => {
    expect(
      shouldAbortNaverResource('https://s.pstatic.net/ico/favicon.ico', 'image', 'warmup'),
    ).toBe(true);
  });

  it('blocks naver home stylesheets', () => {
    expect(
      shouldAbortNaverResource('https://ssl.pstatic.net/static/common.css', 'stylesheet', 'warmup'),
    ).toBe(true);
  });

  it('blocks blog post decorative images but allows script', () => {
    expect(
      shouldAbortNaverResource(
        'https://blogfiles.pstatic.net/thumb.jpg',
        'image',
        'workflow',
        'https://blog.naver.com/yeonun1/2234567890',
      ),
    ).toBe(true);
    expect(
      shouldAbortNaverResource(
        'https://ssl.pstatic.net/js/like.js',
        'script',
        'workflow',
        'https://m.blog.naver.com/yeonun1/2234567890',
      ),
    ).toBe(false);
  });
});
