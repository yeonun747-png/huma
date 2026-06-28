import { describe, expect, it } from 'vitest';
import { getPostingWarmupWeekdayCap } from './posting-warmup.js';

describe('posting warmup day caps', () => {
  it('day 6 uses expand stage cap (3)', () => {
    expect(getPostingWarmupWeekdayCap(6)).toBe(3);
  });

  it('day 0 uses initial cap (1)', () => {
    expect(getPostingWarmupWeekdayCap(0)).toBe(1);
  });
});
