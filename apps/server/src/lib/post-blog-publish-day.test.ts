import { describe, expect, it } from 'vitest';
import {
  isPublishedTodayKst,
  isUntrustedPublishTimestamp,
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

describe('isUntrustedPublishTimestamp', () => {
  it('detects scheduled_at overwritten to worker finish time', () => {
    const finish = '2026-06-23T21:42:25.000Z';
    expect(isUntrustedPublishTimestamp(finish, finish)).toBe(true);
    expect(isUntrustedPublishTimestamp('2026-06-23T11:34:23.000Z', finish)).toBe(false);
  });

  it('rejects scheduled_at later than completed_at', () => {
    const publish = '2026-06-23T11:34:23.000Z';
    const workerFinish = '2026-06-23T21:42:25.000Z';
    expect(isUntrustedPublishTimestamp(workerFinish, publish)).toBe(true);
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

  it('uses _publish_scheduled_at over worker-stamped scheduled/posts', () => {
    const scheduled = '2026-06-23T11:34:23.000Z';
    const workerFinish = '2026-06-23T21:42:25.000Z';
    const iso = resolveJobPublishedAtIso(
      {
        result_url: 'https://blog.naver.com/roast8431/224324945642',
        scheduled_at: workerFinish,
        completed_at: workerFinish,
        platform_schedule: { _publish_scheduled_at: scheduled },
      },
      new Map([['https://blog.naver.com/roast8431/224324945642', workerFinish]]),
    );
    expect(iso).toBe(scheduled);
    expect(isPublishedTodayKst(iso, new Date('2026-06-24T10:00:00+09:00'))).toBe(false);
  });

  it('ignores worker completion stamps when no stored publish time', () => {
    const workerFinish = '2026-06-23T21:42:25.000Z';
    const iso = resolveJobPublishedAtIso(
      {
        result_url: 'https://blog.naver.com/roast8431/224324945642',
        scheduled_at: workerFinish,
        completed_at: workerFinish,
        platform_schedule: null,
      },
      new Map([['https://blog.naver.com/roast8431/224324945642', workerFinish]]),
    );
    expect(iso).toBeNull();
  });

  it('ignores scheduled_at later than backdated completed_at (partial SQL fix)', () => {
    const publish = '2026-06-23T11:34:23.000Z';
    const workerFinish = '2026-06-23T21:42:25.000Z';
    const iso = resolveJobPublishedAtIso({
      result_url: 'https://blog.naver.com/roast8431/224324945642',
      scheduled_at: workerFinish,
      completed_at: publish,
      platform_schedule: { _publish_scheduled_at: publish },
    });
    expect(iso).toBe(publish);
    expect(isPublishedTodayKst(iso, new Date('2026-06-24T10:00:00+09:00'))).toBe(false);
  });
});
