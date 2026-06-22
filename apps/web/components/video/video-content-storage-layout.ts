export const STORAGE_THUMB_WIDTH_PX = 96;
export const STORAGE_GRID_COL_GAP_PX = 8;
export const STORAGE_GRID_ROW_GAP_PX = 8;
export const STORAGE_DETAIL_BAR_HEIGHT_PX = 22;
export const STORAGE_SCROLLBAR_GUTTER_PX = 10;

function gridTrackWidthPx(columnCount: number, thumbWidthPx: number): number {
  if (columnCount <= 0) return 0;
  return columnCount * thumbWidthPx + Math.max(0, columnCount - 1) * STORAGE_GRID_COL_GAP_PX;
}

/** 컨테이너 너비 기준 — 1줄 → 2줄 → 가로 스크롤 */
export function resolveStorageGridLayout(
  containerWidth: number,
  fileCount: number,
  thumbWidthPx = STORAGE_THUMB_WIDTH_PX,
): { rowCount: 1 | 2; needsScroll: boolean } {
  if (fileCount <= 0) return { rowCount: 1, needsScroll: false };
  if (containerWidth <= 0) return { rowCount: 1, needsScroll: false };

  const oneRowWidth = gridTrackWidthPx(fileCount, thumbWidthPx);
  if (oneRowWidth <= containerWidth) return { rowCount: 1, needsScroll: false };

  const twoRowCols = Math.ceil(fileCount / 2);
  const twoRowWidth = gridTrackWidthPx(twoRowCols, thumbWidthPx);
  return { rowCount: 2, needsScroll: twoRowWidth > containerWidth };
}

export function storageThumbHeightPx(thumbWidthPx: number): number {
  return Math.round(thumbWidthPx * (16 / 9));
}

export function storageCardHeightPx(thumbWidthPx: number): number {
  return storageThumbHeightPx(thumbWidthPx) + STORAGE_DETAIL_BAR_HEIGHT_PX;
}

export function storageGridHeightPx(thumbWidthPx: number, rowCount: 1 | 2): number {
  const cardHeight = storageCardHeightPx(thumbWidthPx);
  if (rowCount === 1) return cardHeight;
  return cardHeight * 2 + STORAGE_GRID_ROW_GAP_PX;
}
