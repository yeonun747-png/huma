import { describe, expect, it } from 'vitest';

import { isPureKoreanSeoTitle, sanitizeKoreanSeoTitle } from './seo-title-korean.js';

describe('sanitizeKoreanSeoTitle', () => {
  it('removes pipe and brand suffix', () => {
    expect(sanitizeKoreanSeoTitle('미래 배우자 특성 무료로 알아보기 | 연운')).toBe(
      '미래 배우자 특성 무료로 알아보기 연운',
    );
  });

  it('keeps digits, removes latin', () => {
    expect(sanitizeKoreanSeoTitle('2024 MBTI 연애운 총정리')).toBe('2024 연애운 총정리');
  });
});

describe('isPureKoreanSeoTitle', () => {
  it('accepts hangul with spaces and digits', () => {
    expect(isPureKoreanSeoTitle('2024 미래 배우자 특성')).toBe(true);
  });

  it('rejects special characters', () => {
    expect(isPureKoreanSeoTitle('제목 | 연운')).toBe(false);
  });
});
