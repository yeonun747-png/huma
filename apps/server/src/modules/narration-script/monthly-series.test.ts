import { describe, expect, it } from 'vitest';
import { formatMonthlySeriesLabel } from './monthly-series.js';

describe('monthly-series label', () => {
  it('formats episode label with top N', () => {
    expect(formatMonthlySeriesLabel(1, 12)).toBe('이달 TOP12 시리즈 1편');
    expect(formatMonthlySeriesLabel(3, 5)).toBe('이달 TOP5 시리즈 3편');
  });
});
