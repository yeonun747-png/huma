import { describe, expect, it } from 'vitest';

import { normalizeCaptchaTextAnswer } from './naver-captcha-receipt-prompt.js';

describe('normalizeCaptchaTextAnswer', () => {
  it('strips commas from price answers', () => {
    expect(normalizeCaptchaTextAnswer('6,300', '총 결제 금액은 얼마입니까')).toBe('6300');
  });

  it('keeps Korean blank-fill prefix only', () => {
    expect(normalizeCaptchaTextAnswer('페이지', '[?] 훈제란 입니다')).toBe('페이지');
  });

  it('extracts ml digits without unit', () => {
    expect(normalizeCaptchaTextAnswer('100ml', '용량은 몇 ml 입니까')).toBe('100');
  });

  it('returns null-equivalent empty as-is', () => {
    expect(normalizeCaptchaTextAnswer('', '몇 개')).toBe('');
  });
});
