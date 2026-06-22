import { describe, expect, it } from 'vitest';
import { resolveStorageGridLayout } from './video-content-storage-layout';

describe('resolveStorageGridLayout', () => {
  const thumb = 96;
  const gap = 8;

  function rowWidth(count: number): number {
    return count * thumb + Math.max(0, count - 1) * gap;
  }

  it('uses one row when all cards fit', () => {
    expect(resolveStorageGridLayout(rowWidth(4), 4)).toEqual({ rowCount: 1, needsScroll: false });
  });

  it('wraps to two rows before scrolling when possible', () => {
    const container = rowWidth(4) + 1;
    expect(resolveStorageGridLayout(container, 8)).toEqual({ rowCount: 2, needsScroll: false });
  });

  it('enables horizontal scroll when two rows still overflow', () => {
    const container = rowWidth(3);
    expect(resolveStorageGridLayout(container, 8)).toEqual({ rowCount: 2, needsScroll: true });
  });
});
