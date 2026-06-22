import { describe, expect, it } from 'vitest';
import {
  resolveStorageGridLayout,
  storagePairColumnWidthPx,
  STORAGE_THUMB_WIDTH_PX,
} from './video-content-storage-layout';

describe('resolveStorageGridLayout', () => {
  const thumb = STORAGE_THUMB_WIDTH_PX;
  const gap = 8;

  function rowWidth(pairCount: number, pairStack: 'row' | 'col' = 'col'): number {
    const colW = storagePairColumnWidthPx(thumb, pairStack);
    return pairCount * colW + Math.max(0, pairCount - 1) * gap;
  }

  it('lays pair cards in one horizontal row when they fit', () => {
    expect(resolveStorageGridLayout(rowWidth(3), 3)).toEqual({
      rowCount: 1,
      needsScroll: false,
      pairStack: 'col',
    });
  });

  it('scrolls horizontally instead of wrapping pair cards to a second row', () => {
    const container = rowWidth(2) + 1;
    expect(resolveStorageGridLayout(container, 8)).toEqual({
      rowCount: 1,
      needsScroll: true,
      pairStack: 'col',
    });
  });

  it('stacks subtitled and source vertically inside each pair card', () => {
    const narrow = rowWidth(2);
    expect(resolveStorageGridLayout(narrow, 4)).toEqual({
      rowCount: 1,
      needsScroll: true,
      pairStack: 'col',
    });
  });
});
