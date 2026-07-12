import { describe, expect, it } from 'vitest';
import {
  buildQuizOasisBrandSafetyBlock,
  QUIZOASIS_BRAND_SAFETY_RULES,
} from './quiz-brand-safety.js';

describe('buildQuizOasisBrandSafetyBlock', () => {
  it('injects rules only for quizoasis', () => {
    expect(buildQuizOasisBrandSafetyBlock('quizoasis')).toContain('브랜드 필수');
    expect(buildQuizOasisBrandSafetyBlock('quizoasis')).toContain('틀렸다');
    expect(buildQuizOasisBrandSafetyBlock('yeonun')).toBe('');
    expect(buildQuizOasisBrandSafetyBlock('panana')).toBe('');
  });

  it('bans test-result dunk punchlines', () => {
    expect(QUIZOASIS_BRAND_SAFETY_RULES).toMatch(/테스트 결과/);
    expect(QUIZOASIS_BRAND_SAFETY_RULES).toMatch(/중독/);
    expect(QUIZOASIS_BRAND_SAFETY_RULES).toMatch(/권장/);
  });
});
