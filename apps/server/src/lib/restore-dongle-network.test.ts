import { describe, expect, it } from 'vitest';
import {
  DONGLE_FULL_RESTORE_COOLDOWN_MS,
  DONGLE_SLOT_RESTORE_COOLDOWN_MS,
  isDongleFullRestoreCooldownActive,
  isDongleSlotRestoreCooldownActive,
  remainingDongleFullRestoreCooldownMs,
  remainingDongleSlotRestoreCooldownMs,
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

describe('dongle slot restore cooldown', () => {
  it('tracks per slot independently', () => {
    const now = 2_000_000;
    const slot3Last = now - 30_000;
    const slot5Last = now - 120_000;
    expect(isDongleSlotRestoreCooldownActive(3, now, DONGLE_SLOT_RESTORE_COOLDOWN_MS, slot3Last)).toBe(
      true,
    );
    expect(isDongleSlotRestoreCooldownActive(5, now, DONGLE_SLOT_RESTORE_COOLDOWN_MS, slot5Last)).toBe(
      false,
    );
    expect(remainingDongleSlotRestoreCooldownMs(3, now, DONGLE_SLOT_RESTORE_COOLDOWN_MS, slot3Last)).toBe(
      30_000,
    );
  });
});
