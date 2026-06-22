import { describe, expect, it } from 'vitest';
import {
  VIDEO_CONTENT_LIST_PAGE_SIZE,
  listTotalPages,
  paginateList,
} from './video-content-status';

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
});
