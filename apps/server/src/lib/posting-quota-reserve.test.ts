import { describe, expect, it } from 'vitest';
import { isOrphanPostingReservation } from './posting-quota-reserve.js';

describe('isOrphanPostingReservation', () => {
  it('true when reserved without pipeline jobs', () => {
    expect(isOrphanPostingReservation(0, 1)).toBe(true);
  });

  it('false when pipeline is active', () => {
    expect(isOrphanPostingReservation(1, 1)).toBe(false);
  });

  it('false when nothing reserved', () => {
    expect(isOrphanPostingReservation(0, 0)).toBe(false);
  });
});
