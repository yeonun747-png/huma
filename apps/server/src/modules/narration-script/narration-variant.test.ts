import { describe, expect, it } from 'vitest';
import {
  resolveNarrationFormatForPeriod,
  resolveNarrationRankedTopN,
  resolveNarrationTopN,
  resolveNarrationVariantLabel,
} from '@huma/shared';

describe('narration monthly series (shared)', () => {
  it('monthly forces ranked format', () => {
    expect(resolveNarrationFormatForPeriod('monthly', 'full_cover')).toBe('ranked');
    expect(resolveNarrationFormatForPeriod('daily', 'full_cover')).toBe('full_cover');
  });

  it('resolveNarrationTopN by axis', () => {
    expect(resolveNarrationTopN('zodiac')).toBe(12);
    expect(resolveNarrationTopN('constellation')).toBe(12);
    expect(resolveNarrationTopN('generation')).toBe(5);
  });

  it('resolveNarrationRankedTopN — monthly full pool, daily TOP5', () => {
    expect(resolveNarrationRankedTopN('monthly', 'zodiac')).toBe(12);
    expect(resolveNarrationRankedTopN('monthly', 'generation')).toBe(5);
    expect(resolveNarrationRankedTopN('daily', 'zodiac')).toBe(5);
  });

  it('monthly variant label', () => {
    expect(resolveNarrationVariantLabel('ranked', 'monthly', 'zodiac')).toBe('이달 TOP12 시리즈');
    expect(resolveNarrationVariantLabel('ranked', 'monthly', 'generation')).toBe('이달 TOP5 시리즈');
    expect(resolveNarrationVariantLabel('ranked', 'monthly')).toBe('이달 TOP12 시리즈');
  });
});
