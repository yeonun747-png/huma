import { describe, expect, it } from 'vitest';
import {
  DONGLE_FULL_RESTORE_COOLDOWN_MS,
  isDongleFullRestoreCooldownActive,
  remainingDongleFullRestoreCooldownMs,
} from './restore-dongle-network.js';

describe('dongle full restore cooldown', () => {
  it('is inactive when cooldown is zero', () => {
    expect(isDongleFullRestoreCooldownActive(1_000_000, 0, 900_000)).toBe(false);
    expect(remainingDongleFullRestoreCooldownMs(1_000_000, 0, 900_000)).toBe(0);
  });

  it('is active within cooldown window after last restore', () => {
    const last = 1_000_000;
    const now = last + 60_000;
    expect(isDongleFullRestoreCooldownActive(now, 180_000, last)).toBe(true);
    expect(remainingDongleFullRestoreCooldownMs(now, 180_000, last)).toBe(120_000);
  });

  it('expires after cooldown window', () => {
    const last = 1_000_000;
    const now = last + DONGLE_FULL_RESTORE_COOLDOWN_MS + 1;
    expect(isDongleFullRestoreCooldownActive(now, DONGLE_FULL_RESTORE_COOLDOWN_MS, last)).toBe(
      false,
    );
  });
});
