import { describe, expect, it } from 'vitest';
import {
  resolveNarrationFormatForPeriod,
  resolveNarrationRankedTopN,
  resolveNarrationVariantLabel,
} from '@huma/shared';

describe('narration format × period (shared)', () => {
  it('monthly keeps selected format like daily/weekly', () => {
    expect(resolveNarrationFormatForPeriod('monthly', 'full_cover')).toBe('full_cover');
    expect(resolveNarrationFormatForPeriod('monthly', 'ranked')).toBe('ranked');
    expect(resolveNarrationFormatForPeriod('daily', 'full_cover')).toBe('full_cover');
  });

  it('resolveNarrationRankedTopN is always TOP5', () => {
    expect(resolveNarrationRankedTopN('monthly', 'zodiac')).toBe(5);
    expect(resolveNarrationRankedTopN('monthly', 'generation')).toBe(5);
    expect(resolveNarrationRankedTopN('daily', 'zodiac')).toBe(5);
  });

  it('variant label for all periods', () => {
    expect(resolveNarrationVariantLabel('full_cover', 'daily')).toBe('전체커버형-데일리');
    expect(resolveNarrationVariantLabel('ranked', 'weekly')).toBe('순위특집형-주간');
    expect(resolveNarrationVariantLabel('full_cover', 'monthly')).toBe('전체커버형-월간');
    expect(resolveNarrationVariantLabel('ranked', 'monthly')).toBe('순위특집형-월간');
  });
});
