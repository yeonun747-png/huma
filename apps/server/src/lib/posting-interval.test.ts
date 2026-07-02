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
import { postingWarmupScheduleSpreadFraction } from './posting-warmup.js';

describe('KST night ban 21~08', () => {
  it('blocks evening and early morning, allows hour 8 and 20', () => {
    expect(isKstNightBan(DEFAULT_NIGHT_BAN_START, DEFAULT_NIGHT_BAN_END, new Date('2026-07-01T21:30:00+09:00'))).toBe(true);
    expect(isKstNightBan(DEFAULT_NIGHT_BAN_START, DEFAULT_NIGHT_BAN_END, new Date('2026-07-01T07:59:00+09:00'))).toBe(true);
    expect(isKstNightBan(DEFAULT_NIGHT_BAN_START, DEFAULT_NIGHT_BAN_END, new Date('2026-07-01T08:00:00+09:00'))).toBe(false);
    expect(isKstNightBan(DEFAULT_NIGHT_BAN_START, DEFAULT_NIGHT_BAN_END, new Date('2026-07-01T20:59:00+09:00'))).toBe(false);
  });

  it('msUntilNightBanEnd from 02:00 targets ~6h to 08:00', () => {
    const ms = msUntilNightBanEnd(DEFAULT_NIGHT_BAN_START, DEFAULT_NIGHT_BAN_END, new Date('2026-07-01T02:00:00+09:00'));
    expect(ms).toBeGreaterThanOrEqual(5.9 * 3_600_000);
    expect(ms).toBeLessThanOrEqual(6.1 * 3_600_000);
  });

  it('msUntilNightBanEnd from 22:00 targets ~10h to 08:00', () => {
    const ms = msUntilNightBanEnd(DEFAULT_NIGHT_BAN_START, DEFAULT_NIGHT_BAN_END, new Date('2026-07-01T22:00:00+09:00'));
    expect(ms).toBeGreaterThanOrEqual(9.9 * 3_600_000);
    expect(ms).toBeLessThanOrEqual(10.1 * 3_600_000);
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
      new Date('2026-07-01T07:01:00+09:00').getTime(),
    );
    expect(candidate.getTime()).toBeLessThan(new Date('2026-07-01T07:15:00+09:00').getTime());
  });
});

describe('computePostingScheduleCandidate', () => {
  it('spreads early warmup across a wide window', () => {
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
          warmupDay: 0,
        }).getTime(),
      );
    }
    const span = Math.max(...times) - Math.min(...times);
    expect(span).toBeGreaterThan(3 * 3_600_000);
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
      });
      expect(candidate.getTime()).toBeGreaterThanOrEqual(earliest.getTime());
      expect(candidate.getTime() - earliest.getTime()).toBeLessThanOrEqual(2 * 3_600_000);
    }
  });
});
