import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NIGHT_BAN_END,
  DEFAULT_NIGHT_BAN_START,
  isKstNightBan,
  msUntilNightBanEnd,
} from './crank-schedule-config.js';
import {
  computeEarliestPostingCandidate,
  computePostingScheduleCandidate,
} from './posting-interval.js';
import { postingWarmupScheduleSpreadFraction, postingDailyTargetSpreadFraction, resolvePostingScheduleSpreadFraction } from './posting-warmup.js';

describe('KST night ban 23~08', () => {
  it('blocks late evening and early morning, allows hour 8 and 22', () => {
    expect(isKstNightBan(DEFAULT_NIGHT_BAN_START, DEFAULT_NIGHT_BAN_END, new Date('2026-07-01T23:30:00+09:00'))).toBe(true);
    expect(isKstNightBan(DEFAULT_NIGHT_BAN_START, DEFAULT_NIGHT_BAN_END, new Date('2026-07-01T07:59:00+09:00'))).toBe(true);
    expect(isKstNightBan(DEFAULT_NIGHT_BAN_START, DEFAULT_NIGHT_BAN_END, new Date('2026-07-01T08:00:00+09:00'))).toBe(false);
    expect(isKstNightBan(DEFAULT_NIGHT_BAN_START, DEFAULT_NIGHT_BAN_END, new Date('2026-07-01T22:59:00+09:00'))).toBe(false);
  });

  it('msUntilNightBanEnd from 02:00 targets ~6h to 08:00', () => {
    const ms = msUntilNightBanEnd(DEFAULT_NIGHT_BAN_START, DEFAULT_NIGHT_BAN_END, new Date('2026-07-01T02:00:00+09:00'));
    expect(ms).toBeGreaterThanOrEqual(5.9 * 3_600_000);
    expect(ms).toBeLessThanOrEqual(6.1 * 3_600_000);
  });

  it('msUntilNightBanEnd from 23:30 targets ~8.5h to 08:00', () => {
    const ms = msUntilNightBanEnd(DEFAULT_NIGHT_BAN_START, DEFAULT_NIGHT_BAN_END, new Date('2026-07-01T23:30:00+09:00'));
    expect(ms).toBeGreaterThanOrEqual(8.4 * 3_600_000);
    expect(ms).toBeLessThanOrEqual(8.6 * 3_600_000);
  });
});

describe('postingWarmupScheduleSpreadFraction', () => {
  it('uses wider spread for lower warmup days', () => {
    expect(postingWarmupScheduleSpreadFraction(0)).toBe(1);
    expect(postingWarmupScheduleSpreadFraction(5)).toBe(0.75);
    expect(postingWarmupScheduleSpreadFraction(9)).toBe(0.5);
    expect(postingWarmupScheduleSpreadFraction(14)).toBe(0.25);
    expect(postingWarmupScheduleSpreadFraction(20)).toBe(0.08);
  });
});

describe('computeEarliestPostingCandidate', () => {
  it('uses active window start when now is before window', () => {
    const now = new Date('2026-07-01T06:30:00+09:00');
    const candidate = computeEarliestPostingCandidate({
      now,
      winStartHour: 8,
      minGapMs: 2 * 3_600_000,
      lastAnchor: null,
    });
    expect(candidate.getTime()).toBeGreaterThanOrEqual(
      new Date('2026-07-01T08:01:00+09:00').getTime(),
    );
    expect(candidate.getTime()).toBeLessThan(new Date('2026-07-01T08:09:00+09:00').getTime());
  });
});

describe('postingDailyTargetSpreadFraction', () => {
  it('uses narrow spread for 4+ daily posts, wide for 1-2', () => {
    expect(postingDailyTargetSpreadFraction(5)).toBeLessThanOrEqual(0.12);
    expect(postingDailyTargetSpreadFraction(4)).toBeLessThanOrEqual(0.15);
    expect(postingDailyTargetSpreadFraction(2)).toBeGreaterThanOrEqual(0.55);
    expect(postingDailyTargetSpreadFraction(1)).toBe(1);
  });

  it('resolvePostingScheduleSpreadFraction widens low-volume mature accounts', () => {
    expect(resolvePostingScheduleSpreadFraction(20, 1)).toBe(1);
    expect(resolvePostingScheduleSpreadFraction(20, 2)).toBeGreaterThanOrEqual(0.55);
    expect(resolvePostingScheduleSpreadFraction(20, 4)).toBeLessThanOrEqual(0.15);
  });
});

describe('computePostingScheduleCandidate', () => {
  it('spreads low daily target mature accounts across a wide window', () => {
    const now = new Date('2026-07-01T08:30:00+09:00');
    const times: number[] = [];
    for (let i = 0; i < 40; i += 1) {
      times.push(
        computePostingScheduleCandidate({
          now,
          winStartHour: 8,
          winEndHour: 22,
          minGapMs: 2 * 3_600_000,
          lastAnchor: null,
          warmupDay: 20,
          dailyTarget: 1,
        }).getTime(),
      );
    }
    const span = Math.max(...times) - Math.min(...times);
    expect(span).toBeGreaterThan(4 * 3_600_000);
  });

  it('keeps mature warmup near earliest slot', () => {
    const now = new Date('2026-07-01T10:00:00+09:00');
    const earliest = computeEarliestPostingCandidate({
      now,
      winStartHour: 8,
      minGapMs: 2 * 3_600_000,
      lastAnchor: null,
    });
    for (let i = 0; i < 20; i += 1) {
      const candidate = computePostingScheduleCandidate({
        now,
        winStartHour: 8,
        winEndHour: 22,
        minGapMs: 2 * 3_600_000,
        lastAnchor: null,
        warmupDay: 20,
        dailyTarget: 5,
      });
      expect(candidate.getTime()).toBeGreaterThanOrEqual(earliest.getTime());
      expect(candidate.getTime() - earliest.getTime()).toBeLessThanOrEqual(2 * 3_600_000);
    }
  });
});
