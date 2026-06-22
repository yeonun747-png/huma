import { describe, expect, it } from 'vitest';
import { getDailyPostingTarget } from './posting-daily-target.js';
import { computeDynamicPublishIntervalHours } from './posting-interval.js';
import { getPostingWarmupWeekdayCap, applyPostingWarmupCap } from './posting-warmup.js';

describe('getDailyPostingTarget', () => {
  const accountId = 'acc-test-001';

  it('weekday target is 4 or 5', () => {
    const monday = new Date('2026-06-22T12:00:00+09:00');
    const t = getDailyPostingTarget(accountId, monday);
    expect(t.is_weekend).toBe(false);
    expect([4, 5]).toContain(t.target);
    expect(t.target).toBe(t.raw_target);
  });

  it('same account+date yields same target', () => {
    const d = new Date('2026-06-23T10:00:00+09:00');
    const a = getDailyPostingTarget(accountId, d);
    const b = getDailyPostingTarget(accountId, d);
    expect(a).toEqual(b);
  });

  it('weekend target is 40-50% of weekday base (min 1)', () => {
    const sunday = new Date('2026-06-21T12:00:00+09:00');
    const t = getDailyPostingTarget(accountId, sunday);
    expect(t.is_weekend).toBe(true);
    expect(t.weekend_ratio).toBeGreaterThanOrEqual(0.4);
    expect(t.weekend_ratio!).toBeLessThanOrEqual(0.5 + 1e-9);
    expect(t.target).toBeGreaterThanOrEqual(1);
    expect(t.target).toBeLessThanOrEqual(t.weekday_base);
  });

  it('warmup caps weekday target', () => {
    const monday = new Date('2026-06-22T12:00:00+09:00');
    const fresh = getDailyPostingTarget(accountId, monday, { warmupDay: 0 });
    expect(fresh.target).toBeLessThanOrEqual(1);
    const mid = getDailyPostingTarget(accountId, monday, { warmupDay: 8 });
    expect(mid.target).toBeLessThanOrEqual(3);
  });
});

describe('posting warmup ramp', () => {
  it('ramps 1→2→3→4→full', () => {
    expect(getPostingWarmupWeekdayCap(0)).toBe(1);
    expect(getPostingWarmupWeekdayCap(3)).toBe(2);
    expect(getPostingWarmupWeekdayCap(7)).toBe(3);
    expect(getPostingWarmupWeekdayCap(12)).toBe(4);
    expect(getPostingWarmupWeekdayCap(20)).toBe(999);
  });

  it('applyPostingWarmupCap respects weekend', () => {
    expect(applyPostingWarmupCap(5, 0, true, 0.45)).toBe(1);
  });
});

describe('computeDynamicPublishIntervalHours', () => {
  it('never below floor 2h', () => {
    expect(computeDynamicPublishIntervalHours(10, 14, 2)).toBeGreaterThanOrEqual(2);
  });

  it('scales with target count', () => {
    const few = computeDynamicPublishIntervalHours(2, 14, 2);
    const many = computeDynamicPublishIntervalHours(5, 14, 2);
    expect(few).toBeGreaterThan(many);
  });
});
