import { describe, expect, it, afterAll } from 'vitest';

import {
  decideModemStatusAfterProbeFailure,
  readProbeFailureStreak,
  recordProbeFailureStreak,
  resetProbeFailureStreak,
} from './modem-probe-failure-streak.js';

describe('decideModemStatusAfterProbeFailure', () => {
  it('keeps idle on first failures below threshold', () => {
    expect(decideModemStatusAfterProbeFailure('idle', 1, 3)).toMatchObject({
      nextStatus: 'idle',
      markError: false,
      clearPublicGeo: false,
    });
    expect(decideModemStatusAfterProbeFailure('idle', 2, 3).markError).toBe(false);
  });

  it('marks error at threshold', () => {
    expect(decideModemStatusAfterProbeFailure('idle', 3, 3)).toMatchObject({
      nextStatus: 'error',
      markError: true,
      clearPublicGeo: true,
    });
  });

  it('does not change busy', () => {
    expect(decideModemStatusAfterProbeFailure('busy', 5, 3)).toMatchObject({
      nextStatus: 'busy',
      markError: false,
    });
  });

  it('keeps reconnecting until threshold', () => {
    expect(decideModemStatusAfterProbeFailure('reconnecting', 1, 3).nextStatus).toBe('reconnecting');
  });
});

describe('probe failure streak files', () => {
  const slot = 99;
  const prev = process.env.HUMA_MODEM_PROBE_STREAK_DIR;
  const dir = `${process.cwd()}/.tmp-modem-probe-streak-test`;

  process.env.HUMA_MODEM_PROBE_STREAK_DIR = dir;

  it('increments and resets', () => {
    resetProbeFailureStreak(slot);
    expect(readProbeFailureStreak(slot)).toBe(0);
    expect(recordProbeFailureStreak(slot)).toBe(1);
    expect(recordProbeFailureStreak(slot)).toBe(2);
    resetProbeFailureStreak(slot);
    expect(readProbeFailureStreak(slot)).toBe(0);
  });

  afterAll(() => {
    if (prev === undefined) delete process.env.HUMA_MODEM_PROBE_STREAK_DIR;
    else process.env.HUMA_MODEM_PROBE_STREAK_DIR = prev;
    resetProbeFailureStreak(slot);
  });
});
