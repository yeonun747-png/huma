import { describe, expect, it } from 'vitest';

import {
  isBlogEditorOrPublishContext,
  isLoginOrCaptchaUrl,
  isLightweightImageUrl,
  shouldAbortNaverResource,
  shouldBlockHeavyImage,
} from './naver-resource-block.js';

describe('isLoginOrCaptchaUrl', () => {
  it('matches nid login', () => {
    expect(isLoginOrCaptchaUrl('https://nid.naver.com/nidlogin.login')).toBe(true);
  });

  it('matches captcha path', () => {
    expect(isLoginOrCaptchaUrl('https://nid.naver.com/captcha?rand=abc')).toBe(true);
  });
});

describe('isLightweightImageUrl', () => {
  it('allows favicon and svg', () => {
    expect(isLightweightImageUrl('https://s.pstatic.net/ico/favicon.ico')).toBe(true);
    expect(isLightweightImageUrl('https://ssl.pstatic.net/icon/logo.svg')).toBe(true);
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

describe('shouldBlockHeavyImage', () => {
  it('blocks jpg but allows ico', () => {
    expect(shouldBlockHeavyImage('https://s.pstatic.net/news/banner.jpg', 'image')).toBe(true);
    expect(shouldBlockHeavyImage('https://s.pstatic.net/ico/favicon.ico', 'image')).toBe(false);
  });
});

describe('shouldAbortNaverResource', () => {
  it('always blocks ad hosts', () => {
    expect(shouldAbortNaverResource('https://ader.naver.com/foo', 'script')).toBe(true);
  });

  it('allows captcha images on nid', () => {
    expect(shouldAbortNaverResource('https://nid.naver.com/captcha?rand=1', 'image')).toBe(false);
  });

  it('allows editor scripts', () => {
    expect(
      shouldAbortNaverResource(
        'https://ssl.pstatic.net/static/se/editor.js',
        'script',
        'https://blog.naver.com/yeonun1/postwrite',
      ),
    ).toBe(false);
  });

  it('allows CSS and fonts on naver home', () => {
    expect(shouldAbortNaverResource('https://ssl.pstatic.net/static/common.css', 'stylesheet')).toBe(
      false,
    );
    expect(shouldAbortNaverResource('https://ssl.pstatic.net/static/font.woff2', 'font')).toBe(false);
  });

  it('allows icons but blocks photo banners (remote and automation same rule)', () => {
    expect(shouldAbortNaverResource('https://s.pstatic.net/ico/favicon.ico', 'image')).toBe(false);
    expect(shouldAbortNaverResource('https://s.pstatic.net/news/banner.jpg', 'image')).toBe(true);
  });

  it('blocks media everywhere', () => {
    expect(shouldAbortNaverResource('https://tv.naver.com/embed/mp4', 'media')).toBe(true);
  });

  it('blog post read allows CSS but blocks thumbnails', () => {
    expect(
      shouldAbortNaverResource(
        'https://ssl.pstatic.net/skin/blog.css',
        'stylesheet',
        'https://blog.naver.com/yeonun1/2234567890',
      ),
    ).toBe(false);
    expect(
      shouldAbortNaverResource(
        'https://blogfiles.pstatic.net/thumb.jpg',
        'image',
        'https://blog.naver.com/yeonun1/2234567890',
      ),
    ).toBe(true);
  });

  it('editor allows uploaded blogfiles images', () => {
    expect(
      shouldAbortNaverResource(
        'https://blogfiles.pstatic.net/2024/photo.jpg',
        'image',
        'https://blog.naver.com/yeonun1/postwrite',
      ),
    ).toBe(false);
  });
});
