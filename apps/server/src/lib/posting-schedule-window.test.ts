import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NIGHT_BAN_END,
  DEFAULT_NIGHT_BAN_START,
  msUntilNightBanStart,
} from './crank-schedule-config.js';
import {
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
