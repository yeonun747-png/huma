import { describe, expect, it } from 'vitest';
import {
  VIDEO_CONTENT_LIST_PAGE_SIZE,
  elapsedSecSince,
  formatElapsedDurationSec,
  listPageSizeForVideoContentTab,
  listTotalPages,
  paginateList,
  resolveVideoContentProgressSince,
} from './video-content-status';
import type { HumaVideoContentHistory } from '@huma/shared';

describe('video content list pagination', () => {
  it('uses page size 7 for all tabs', () => {
    expect(VIDEO_CONTENT_LIST_PAGE_SIZE).toBe(7);
    expect(listPageSizeForVideoContentTab('review')).toBe(7);
    expect(listPageSizeForVideoContentTab('progress')).toBe(7);
    expect(listPageSizeForVideoContentTab('done')).toBe(7);
    expect(listPageSizeForVideoContentTab('failed')).toBe(7);
  });

  it('paginates from 8 items', () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    expect(paginateList(items, 1)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(paginateList(items, 2)).toEqual([8]);
    expect(listTotalPages(items.length)).toBe(2);
    expect(items.length > VIDEO_CONTENT_LIST_PAGE_SIZE).toBe(true);
  });

  it('does not paginate at 7 items or fewer', () => {
    const items = [1, 2, 3, 4, 5, 6, 7];
    expect(paginateList(items, 1)).toEqual(items);
    expect(listTotalPages(items.length)).toBe(1);
    expect(items.length > VIDEO_CONTENT_LIST_PAGE_SIZE).toBe(false);
  });

  it('formats elapsed duration', () => {
    expect(formatElapsedDurationSec(45)).toBe('45초');
    expect(formatElapsedDurationSec(125)).toBe('2분 5초');
    expect(elapsedSecSince('2020-01-01T00:00:00.000Z', Date.parse('2020-01-01T00:02:30.000Z'))).toBe(150);
  });

  it('uses render start for rendering progress', () => {
    const item: Pick<HumaVideoContentHistory, 'status' | 'created_at' | 'conti_json' | 'progress_since_at'> = {
      status: 'rendering',
      created_at: '2020-01-01T00:00:00.000Z',
      conti_json: { videoRenderStartedAt: '2020-01-01T00:10:00.000Z' },
    };
    expect(resolveVideoContentProgressSince(item)).toBe('2020-01-01T00:10:00.000Z');
  });

  it('uses created_at for conti_generating', () => {
    const item: Pick<HumaVideoContentHistory, 'status' | 'created_at' | 'conti_json' | 'progress_since_at'> = {
      status: 'conti_generating',
      created_at: '2020-01-01T00:00:00.000Z',
      conti_json: null,
    };
    expect(resolveVideoContentProgressSince(item)).toBe('2020-01-01T00:00:00.000Z');
  });
});
