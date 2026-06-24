import { describe, expect, it } from 'vitest';
import {
  coalesceAutoPublishNextSlot,
  deferAutoPublishRetryIso,
  resolveBlockedAutoPublishNextSlot,
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

describe('resolveBlockedAutoPublishNextSlot', () => {
  it('QUOTA returns null — no 5~15min defer loop', async () => {
    const result = await resolveBlockedAutoPublishNextSlot(
      {
        workspace: 'yeonun',
        today_completed: 1,
        today_skipped: 0,
        daily_target: 1,
        weekday_base: 4,
        remaining: 0,
        hard_cap: 99,
        can_publish: false,
        block_reason: 'QUOTA',
        auto_pick_ready: true,
        is_weekend: false,
        in_flight: 0,
      },
      { accountId: 'acc-3', plannedCount: 2, consumedCount: 1 },
      '2026-06-25T08:26:00+09:00',
    );
    expect(result).toBeNull();
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
