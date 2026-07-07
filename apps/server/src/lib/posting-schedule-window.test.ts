import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NIGHT_BAN_END,
  DEFAULT_NIGHT_BAN_START,
  isKstNightBan,
  msUntilNightBanStart,
} from './crank-schedule-config.js';
import {
  clampCandidateBeforeNightBan,
  resolvePostingDayWindow,
  shouldPackPostingBeforeNightBan,
} from './posting-schedule-window.js';

describe('msUntilNightBanStart', () => {
  it('from 20:00 targets ~3h to 23:00', () => {
    const ms = msUntilNightBanStart(
      DEFAULT_NIGHT_BAN_START,
      DEFAULT_NIGHT_BAN_END,
      new Date('2026-07-01T20:00:00+09:00'),
    );
    expect(ms).toBeGreaterThanOrEqual(2.9 * 3_600_000);
    expect(ms).toBeLessThanOrEqual(3.1 * 3_600_000);
  });

  it('returns 0 during night ban', () => {
    expect(
      msUntilNightBanStart(
        DEFAULT_NIGHT_BAN_START,
        DEFAULT_NIGHT_BAN_END,
        new Date('2026-07-02T01:00:00+09:00'),
      ),
    ).toBe(0);
  });
});

describe('resolvePostingDayWindow', () => {
  const activeHours = Array.from({ length: 24 }, (_, h) => (h >= 8 && h <= 22 ? 0.5 : 0.1));

  it('caps window end at night ban start (23)', () => {
    expect(resolvePostingDayWindow(activeHours, 23)).toEqual({ start: 8, end: 23 });
  });
});

describe('shouldPackPostingBeforeNightBan', () => {
  it('packs when remaining slots cannot fit before ban', () => {
    const urgent = shouldPackPostingBeforeNightBan({
      remainingSlots: 2,
      minGapMs: 2 * 3_600_000,
      from: new Date('2026-07-01T21:30:00+09:00'),
    });
    expect(urgent).toBe(true);
  });

  it('does not pack when enough time remains', () => {
    const urgent = shouldPackPostingBeforeNightBan({
      remainingSlots: 2,
      minGapMs: 2 * 3_600_000,
      from: new Date('2026-07-01T14:00:00+09:00'),
    });
    expect(urgent).toBe(false);
  });
});

describe('clampCandidateBeforeNightBan', () => {
  it('keeps evening slots before 23:00', () => {
    const at = new Date('2026-07-01T22:30:00+09:00');
    expect(clampCandidateBeforeNightBan(at).getTime()).toBe(at.getTime());
  });

  it('pulls 23:52 back to same evening before ban', () => {
    const at = new Date('2026-07-01T23:52:00+09:00');
    const now = new Date('2026-07-01T22:00:00+09:00');
    const out = clampCandidateBeforeNightBan(at, DEFAULT_NIGHT_BAN_START, DEFAULT_NIGHT_BAN_END, now);
    expect(isKstNightBan(DEFAULT_NIGHT_BAN_START, DEFAULT_NIGHT_BAN_END, out)).toBe(false);
    expect(out.getTime()).toBeGreaterThanOrEqual(new Date('2026-07-01T22:48:00+09:00').getTime());
    expect(out.getTime()).toBeLessThan(new Date('2026-07-01T23:00:00+09:00').getTime());
  });

  it('moves early-morning ban slots to same-day 08:00', () => {
    const at = new Date('2026-07-02T02:30:00+09:00');
    const out = clampCandidateBeforeNightBan(at);
    expect(isKstNightBan(DEFAULT_NIGHT_BAN_START, DEFAULT_NIGHT_BAN_END, out)).toBe(false);
    expect(out.getTime()).toBeGreaterThanOrEqual(new Date('2026-07-02T08:01:00+09:00').getTime());
    expect(out.getTime()).toBeLessThan(new Date('2026-07-02T08:15:00+09:00').getTime());
  });
});
