import { describe, expect, it } from 'vitest';
import {
  DONGLE_PRE_SLOT_HEALTH_LEAD_MS,
  isWithinPreSlotHealthWindow,
} from './dongle-pre-slot-health.js';

describe('isWithinPreSlotHealthWindow', () => {
  it('is true within 10 minutes before next slot', () => {
    const now = Date.parse('2026-06-26T06:50:00.000Z');
    const next = '2026-06-26T07:00:00.000Z';
    expect(isWithinPreSlotHealthWindow(next, now)).toBe(true);
  });

  it('is false when more than 10 minutes remain', () => {
    const now = Date.parse('2026-06-26T06:40:00.000Z');
    const next = '2026-06-26T07:00:00.000Z';
    expect(isWithinPreSlotHealthWindow(next, now, DONGLE_PRE_SLOT_HEALTH_LEAD_MS)).toBe(false);
  });

  it('is false when slot is due or past', () => {
    const now = Date.parse('2026-06-26T07:00:00.000Z');
    const next = '2026-06-26T07:00:00.000Z';
    expect(isWithinPreSlotHealthWindow(next, now)).toBe(false);
  });
});
