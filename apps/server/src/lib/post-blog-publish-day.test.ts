import { describe, expect, it } from 'vitest';
import {
  isPublishedTodayKst,
  resolveJobPublishedAtIso,
} from './post-blog-publish-day.js';
import { formatKstDateKey } from './posting-daily-target.js';

describe('isPublishedTodayKst', () => {
  it('uses KST calendar day', () => {
    const now = new Date('2026-06-23T15:00:00+09:00');
    const todayPublish = new Date('2026-06-23T20:34:23+09:00').toISOString();
    const yesterday = new Date('2026-06-22T20:34:23+09:00').toISOString();
    expect(isPublishedTodayKst(todayPublish, now)).toBe(true);
    expect(isPublishedTodayKst(yesterday, now)).toBe(false);
    expect(formatKstDateKey(new Date(todayPublish))).toBe('2026-06-23');
  });
});

describe('resolveJobPublishedAtIso', () => {
  it('prefers reconcile publish timestamp over completed_at', () => {
    const iso = resolveJobPublishedAtIso({
      result_url: 'https://blog.naver.com/x/1',
      completed_at: '2026-06-23T12:00:00.000Z',
      platform_schedule: {
        _reconcile_publish_at: '2026-06-23T11:34:23.000Z',
        _reconciled_from_failed: true,
      },
    });
    expect(iso).toBe('2026-06-23T11:34:23.000Z');
  });

  it('does not fall back to completed_at for reconcile without stored publish time', () => {
    const iso = resolveJobPublishedAtIso({
      result_url: 'https://blog.naver.com/x/1',
      completed_at: '2026-06-23T12:00:00.000Z',
      platform_schedule: { _reconciled_from_failed: true },
    });
    expect(iso).toBeNull();
  });
});
