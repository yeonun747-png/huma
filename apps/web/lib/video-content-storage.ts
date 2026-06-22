export type VideoContentStorageFilter =
  | 'uploaded_with_source'
  | 'older_than_30'
  | 'failed_or_hold'
  | 'all_with_files';

export interface VideoContentStorageSettings {
  ssdCapGb: number;
  warnPercent: number;
  autoCleanupEnabled: boolean;
  autoDeleteSourceDaysAfterUpload: number;
  autoDeleteSubtitledDays: number;
}

export interface VideoContentStorageStats {
  totalBytes: number;
  subtitledBytes: number;
  sourceBytes: number;
  completedCount: number;
  withBothCount: number;
  subtitledOnlyCount: number;
  sourceOnlyCount: number;
  usedPercent: number;
  warnLevel: 'ok' | 'warn' | 'critical';
  ssdCapGb: number;
  warnPercent: number;
  reclaimableSourceBytes: number;
  reclaimableSourceCount: number;
}

export interface VideoContentStorageItem {
  id: string;
  account_id: string;
  workspace: string;
  status: string;
  scenario_summary: string | null;
  created_at: string;
  similarity_score: number | null;
  hasSubtitled: boolean;
  hasSource: boolean;
  subtitledBytes: number;
  sourceBytes: number;
  totalBytes: number;
  allPlatformsUploaded: boolean;
  latestUploadAt: string | null;
  ageDays: number;
  durationSec: number | null;
}

export const STORAGE_FILTER_LABEL: Record<VideoContentStorageFilter, string> = {
  uploaded_with_source: '업로드 완료 + 원본 보관',
  older_than_30: '30일 이상 경과',
  failed_or_hold: '실패·보류',
  all_with_files: '파일 있는 전체',
};

export function formatStorageBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

/** 썸네일 뱃지용 — 13초 */
export function formatVideoDurationSec(sec: number | null | undefined): string | null {
  if (sec == null || sec <= 0 || !Number.isFinite(sec)) return null;
  return `${Math.round(sec)}초`;
}

export interface VideoContentStorageFile {
  historyId: string;
  variant: 'subtitled' | 'source';
  fileName: string;
  label: string;
  bytes: number;
  account_id: string;
  workspace: string;
  scenario_summary: string | null;
  status: string;
  created_at: string;
  durationSec: number | null;
}

function storageFileFromItem(
  item: VideoContentStorageItem,
  variant: 'subtitled' | 'source',
): VideoContentStorageFile {
  const short = item.id.slice(0, 8);
  const base = {
    historyId: item.id,
    account_id: item.account_id,
    workspace: item.workspace,
    scenario_summary: item.scenario_summary,
    status: item.status,
    created_at: item.created_at,
    durationSec: item.durationSec,
  };
  if (variant === 'subtitled') {
    return {
      ...base,
      variant,
      fileName: `${short}-subtitled.mp4`,
      label: '자막본',
      bytes: item.subtitledBytes,
    };
  }
  return {
    ...base,
    variant,
    fileName: `${short}-source.mp4`,
    label: '원본',
    bytes: item.sourceBytes,
  };
}

/** 작업 1건 — 자막본·원본 쌍 */
export interface VideoContentStoragePair {
  historyId: string;
  account_id: string;
  workspace: string;
  scenario_summary: string | null;
  status: string;
  created_at: string;
  durationSec: number | null;
  subtitled: VideoContentStorageFile | null;
  source: VideoContentStorageFile | null;
}

export function pairTotalBytes(pair: VideoContentStoragePair): number {
  return (pair.subtitled?.bytes ?? 0) + (pair.source?.bytes ?? 0);
}

/** 작업별로 자막본·원본을 묶어 반환 (용량 큰 작업 우선) */
export function groupStorageFiles(items: VideoContentStorageItem[]): VideoContentStoragePair[] {
  return items
    .filter((item) => item.hasSubtitled || item.hasSource)
    .map((item) => ({
      historyId: item.id,
      account_id: item.account_id,
      workspace: item.workspace,
      scenario_summary: item.scenario_summary,
      status: item.status,
      created_at: item.created_at,
      durationSec: item.durationSec,
      subtitled: item.hasSubtitled ? storageFileFromItem(item, 'subtitled') : null,
      source: item.hasSource ? storageFileFromItem(item, 'source') : null,
    }))
    .sort((a, b) => pairTotalBytes(b) - pairTotalBytes(a));
}

/** @deprecated groupStorageFiles 사용 */
export function flattenStorageFiles(items: VideoContentStorageItem[]): VideoContentStorageFile[] {
  const files: VideoContentStorageFile[] = [];
  for (const pair of groupStorageFiles(items)) {
    if (pair.subtitled) files.push(pair.subtitled);
    if (pair.source) files.push(pair.source);
  }
  return files;
}
