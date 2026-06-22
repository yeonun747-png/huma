export const STORAGE_THUMB_WIDTH_PX = 96;
export const STORAGE_PAIR_INNER_GAP_PX = 4;
export const STORAGE_GRID_COL_GAP_PX = 8;
export const STORAGE_GRID_ROW_GAP_PX = 8;
export const STORAGE_DETAIL_BAR_HEIGHT_PX = 22;
export const STORAGE_SCROLLBAR_GUTTER_PX = 10;

export type StoragePairStack = 'row' | 'col';

function gridTrackWidthPx(columnCount: number, columnWidthPx: number): number {
  if (columnCount <= 0) return 0;
  return columnCount * columnWidthPx + Math.max(0, columnCount - 1) * STORAGE_GRID_COL_GAP_PX;
}

export function storagePairColumnWidthPx(
  thumbWidthPx: number,
  pairStack: StoragePairStack,
): number {
  if (pairStack === 'col') return thumbWidthPx;
  return thumbWidthPx * 2 + STORAGE_PAIR_INNER_GAP_PX;
}

export function storageThumbHeightPx(thumbWidthPx: number): number {
  return Math.round(thumbWidthPx * (16 / 9));
}

export function storageCardHeightPx(thumbWidthPx: number): number {
  return storageThumbHeightPx(thumbWidthPx) + STORAGE_DETAIL_BAR_HEIGHT_PX;
}

export function storagePairCardHeightPx(
  thumbWidthPx: number,
  pairStack: StoragePairStack,
  fileCount: 1 | 2,
): number {
  const thumbH = storageThumbHeightPx(thumbWidthPx);
  const thumbsH =
    fileCount === 1
      ? thumbH
      : pairStack === 'row'
        ? thumbH
        : thumbH * 2 + STORAGE_PAIR_INNER_GAP_PX;
  return thumbsH + STORAGE_DETAIL_BAR_HEIGHT_PX;
}

export function storageGridHeightPx(
  thumbWidthPx: number,
  rowCount: 1 | 2,
  pairStack: StoragePairStack,
): number {
  const cardHeight = storagePairCardHeightPx(thumbWidthPx, pairStack, 2);
  if (rowCount === 1) return cardHeight;
  return cardHeight * 2 + STORAGE_GRID_ROW_GAP_PX;
}

function fitsInWidth(containerWidth: number, columnCount: number, columnWidthPx: number): boolean {
  if (columnCount <= 0) return true;
  return gridTrackWidthPx(columnCount, columnWidthPx) <= containerWidth;
}

/** 컨테이너 너비 기준 — 쌍 내부 상하(자막본·원본), 쌍 카드는 가로 1줄 → 넘치면 가로 스크롤 */
export function resolveStorageGridLayout(
  containerWidth: number,
  pairCount: number,
  thumbWidthPx = STORAGE_THUMB_WIDTH_PX,
): { rowCount: 1 | 2; needsScroll: boolean; pairStack: StoragePairStack } {
  if (pairCount <= 0) return { rowCount: 1, needsScroll: false, pairStack: 'col' };
  if (containerWidth <= 0) return { rowCount: 1, needsScroll: false, pairStack: 'col' };

  const pairStack: StoragePairStack = 'col';
  const colWidth = storagePairColumnWidthPx(thumbWidthPx, pairStack);

  return {
    rowCount: 1,
    needsScroll: !fitsInWidth(containerWidth, pairCount, colWidth),
    pairStack,
  };
}
