import { describe, expect, it } from 'vitest';
import {
  buildSevenDayMissTrendFromPosts,
  trendDirection,
} from './service.js';

describe('buildSevenDayMissTrendFromPosts', () => {
  const now = new Date('2026-06-24T12:00:00+09:00');

  it('groups misses by KST publish day using latest badges (not scan day)', () => {
    const posts = [
      {
        post_no: '1',
        published_at: '2026-06-20T10:00:00+09:00',
      },
      {
        post_no: '2',
        published_at: '2026-06-21T10:00:00+09:00',
      },
      {
        post_no: '3',
        published_at: '2026-06-22T10:00:00+09:00',
      },
    ];
    const status = new Map([
      ['1', { status: 'good' }],
      ['2', { status: 'miss' }],
      ['3', { status: 'miss' }],
    ]);

    const trend = buildSevenDayMissTrendFromPosts(posts, status, now);
    // 6/18..6/24 — 금(20)=0, 토(21)=1, 일(22)=1
    expect(trend).toEqual([null, null, 0, 1, 1, null, null]);
    expect(trendDirection(trend)).not.toBe('데이터 부족');
  });

  it('returns null for days without published scanned posts', () => {
    const trend = buildSevenDayMissTrendFromPosts(
      [{ post_no: '9', published_at: '2026-06-24T08:00:00+09:00' }],
      new Map([['9', { status: 'strong' }]]),
      now,
    );
    expect(trend.filter((v) => v !== null).length).toBe(1);
    expect(trendDirection(trend)).toBe('데이터 부족');
  });
});

describe('trendDirection', () => {
  it('needs at least two days with data', () => {
    expect(trendDirection([null, null, 0, null, null, null, null])).toBe('데이터 부족');
    expect(trendDirection([null, 1, 2, null, null, null, null])).toBe('악화');
  });
});
