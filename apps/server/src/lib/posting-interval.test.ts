import { describe, expect, it } from 'vitest';
import { isKstNightBan, msUntilNightBanEnd } from './crank-schedule-config.js';
import { computeEarliestPostingCandidate } from './posting-interval.js';

describe('KST night ban 00~07', () => {
  it('blocks hour 0 and 6, allows hour 7', () => {
    expect(isKstNightBan(0, 7, new Date('2026-07-01T00:30:00+09:00'))).toBe(true);
    expect(isKstNightBan(0, 7, new Date('2026-07-01T06:59:00+09:00'))).toBe(true);
    expect(isKstNightBan(0, 7, new Date('2026-07-01T07:00:00+09:00'))).toBe(false);
  });

  it('msUntilNightBanEnd from 02:00 targets ~5h to 07:00', () => {
    const ms = msUntilNightBanEnd(0, 7, new Date('2026-07-01T02:00:00+09:00'));
    expect(ms).toBeGreaterThanOrEqual(4.9 * 3_600_000);
    expect(ms).toBeLessThanOrEqual(5.1 * 3_600_000);
  });
});

describe('computeEarliestPostingCandidate', () => {
  it('uses active window start when now is before window', () => {
    const now = new Date('2026-07-01T06:30:00+09:00');
    const candidate = computeEarliestPostingCandidate({
      now,
      winStartHour: 7,
      minGapMs: 2 * 3_600_000,
      lastAnchor: null,
    });
    expect(candidate.getTime()).toBeGreaterThanOrEqual(
      new Date('2026-07-01T07:01:00+09:00').getTime(),
    );
    expect(candidate.getTime()).toBeLessThan(new Date('2026-07-01T07:15:00+09:00').getTime());
  });
});
