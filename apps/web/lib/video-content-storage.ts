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
}

export function flattenStorageFiles(items: VideoContentStorageItem[]): VideoContentStorageFile[] {
  const files: VideoContentStorageFile[] = [];
  for (const item of items) {
    const short = item.id.slice(0, 8);
    const base = {
      historyId: item.id,
      account_id: item.account_id,
      workspace: item.workspace,
      scenario_summary: item.scenario_summary,
      status: item.status,
      created_at: item.created_at,
    };
    if (item.hasSubtitled) {
      files.push({
        ...base,
        variant: 'subtitled',
        fileName: `${short}-subtitled.mp4`,
        label: '자막본',
        bytes: item.subtitledBytes,
      });
    }
    if (item.hasSource) {
      files.push({
        ...base,
        variant: 'source',
        fileName: `${short}-source.mp4`,
        label: '원본',
        bytes: item.sourceBytes,
      });
    }
  }
  return files.sort((a, b) => b.bytes - a.bytes);
}
