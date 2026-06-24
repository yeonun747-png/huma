import { describe, expect, it } from 'vitest';
import {
  coalesceAutoPublishNextSlot,
  deferAutoPublishRetryIso,
} from './auto-publish-state.js';

describe('deferAutoPublishRetryIso', () => {
  it('returns ISO within the requested minute window', () => {
    const before = Date.now();
    const iso = deferAutoPublishRetryIso(2, 4);
    const ms = new Date(iso).getTime() - before;
    expect(ms).toBeGreaterThanOrEqual(2 * 60_000 - 50);
    expect(ms).toBeLessThanOrEqual(4 * 60_000 + 50);
  });
});

describe('coalesceAutoPublishNextSlot', () => {
  const now = Date.parse('2026-06-22T10:00:00+09:00');

  it('keeps a future slot when replan would push it later', () => {
    const existing = '2026-06-22T15:30:00+09:00';
    const proposed = '2026-06-22T17:00:00+09:00';
    expect(coalesceAutoPublishNextSlot(existing, proposed, now)).toBe(existing);
  });

  it('allows replacing a short due claim with the real next slot', () => {
    const existing = new Date(now + 3 * 60_000).toISOString();
    const proposed = '2026-06-22T18:00:00+09:00';
    expect(coalesceAutoPublishNextSlot(existing, proposed, now)).toBe(proposed);
  });

  it('replaces a past-due slot with a new proposal', () => {
    const existing = '2026-06-22T09:50:00+09:00';
    const proposed = '2026-06-22T11:00:00+09:00';
    expect(coalesceAutoPublishNextSlot(existing, proposed, now)).toBe(proposed);
  });
});
