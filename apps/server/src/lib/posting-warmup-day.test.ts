import { describe, expect, it } from 'vitest';
import { getPostingWarmupWeekdayCap } from './posting-warmup.js';
import { postingWarmupResetPatch, resolveWarmupPublishKstDateKey } from './posting-warmup-day.js';

describe('posting warmup day caps', () => {
  it('day 6 uses expand stage cap (3)', () => {
    expect(getPostingWarmupWeekdayCap(6)).toBe(3);
  });

  it('day 0 uses initial cap (1)', () => {
    expect(getPostingWarmupWeekdayCap(0)).toBe(1);
  });
});

describe('postingWarmupResetPatch', () => {
  it('clears warmup counters and sets epoch', () => {
    const patch = postingWarmupResetPatch(new Date('2026-07-01T12:00:00.000Z'));
    expect(patch.warmup_day).toBe(0);
    expect(patch.warmup_last_increment_date).toBeNull();
    expect(patch.posting_warmup_started_kst).toBeNull();
    expect(patch.posting_warmup_epoch_at).toBe('2026-07-01T12:00:00.000Z');
  });
});

describe('resolveWarmupPublishKstDateKey', () => {
  it('falls back to completed_at KST when publish metadata is missing', () => {
    const key = resolveWarmupPublishKstDateKey({
      result_url: 'https://blog.naver.com/foo/1',
      completed_at: '2026-06-17T03:15:00.000Z',
      scheduled_at: null,
      platform_schedule: {},
    });
    expect(key).toBe('2026-06-17');
  });

  it('prefers _publish_scheduled_at over completed_at', () => {
    const key = resolveWarmupPublishKstDateKey({
      result_url: 'https://blog.naver.com/foo/2',
      completed_at: '2026-06-20T01:00:00.000Z',
      scheduled_at: null,
      platform_schedule: { _publish_scheduled_at: '2026-06-18T06:00:00.000Z' },
    });
    expect(key).toBe('2026-06-18');
  });
});
