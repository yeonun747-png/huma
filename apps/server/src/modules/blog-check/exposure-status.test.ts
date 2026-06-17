import { describe, expect, it } from 'vitest';
import { rankToExposureStatus } from './exposure-status.js';

describe('rankToExposureStatus', () => {
  it('maps blai-style rank tiers', () => {
    expect(rankToExposureStatus(1)).toBe('strong');
    expect(rankToExposureStatus(3)).toBe('strong');
    expect(rankToExposureStatus(4)).toBe('good');
    expect(rankToExposureStatus(10)).toBe('good');
    expect(rankToExposureStatus(11)).toBe('weak');
    expect(rankToExposureStatus(30)).toBe('weak');
  });
});
