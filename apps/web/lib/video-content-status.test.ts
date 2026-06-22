import { describe, expect, it } from 'vitest';
import {
  VIDEO_CONTENT_LIST_PAGE_SIZE,
  elapsedSecSince,
  formatElapsedDurationSec,
  listTotalPages,
  paginateList,
  resolveVideoContentProgressSince,
} from './video-content-status';
import type { HumaVideoContentHistory } from '@huma/shared';

describe('video content list pagination', () => {
  it('uses page size 8', () => {
    expect(VIDEO_CONTENT_LIST_PAGE_SIZE).toBe(8);
  });

  it('paginates after 8 items', () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    expect(paginateList(items, 1)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(paginateList(items, 2)).toEqual([9]);
    expect(listTotalPages(items.length)).toBe(2);
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
