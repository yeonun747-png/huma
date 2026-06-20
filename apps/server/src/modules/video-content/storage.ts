import { existsSync, statSync } from 'fs';
import { unlink } from 'fs/promises';
import type { Workspace } from '@huma/shared';
import { supabase } from '../../middleware/auth.js';
import { logOperation } from '../../lib/log-emitter.js';
import { getSetting, updateSetting } from '../../lib/settings.js';
import { videoContentFinalPath, videoContentSourcePath, resolveStoredVideoPath } from './paths.js';
import { removeVideoContentThumb } from './thumbnail.js';

export const VIDEO_CONTENT_STORAGE_SETTING_KEY = 'video_content_storage';

export const UPLOAD_PLATFORMS = ['youtube', 'tiktok', 'instagram', 'threads', 'x'] as const;

export type StorageListFilter =
  | 'uploaded_with_source'
  | 'older_than_30'
  | 'failed_or_hold'
  | 'all_with_files';

export interface VideoContentStorageSettings {
  ssdCapGb: number;
  warnPercent: number;
  autoCleanupEnabled: boolean;
  /** 0 = 비활성. 모든 플랫폼 업로드 완료 후 N일 경과 시 원본 삭제 */
  autoDeleteSourceDaysAfterUpload: number;
  /** 0 = 비활성. 완료 N일 경과 시 자막본 삭제 */
  autoDeleteSubtitledDays: number;
}

export const DEFAULT_VIDEO_CONTENT_STORAGE_SETTINGS: VideoContentStorageSettings = {
  ssdCapGb: 50,
  warnPercent: 80,
  autoCleanupEnabled: false,
  autoDeleteSourceDaysAfterUpload: 7,
  autoDeleteSubtitledDays: 90,
};

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

type HistoryRow = Record<string, unknown>;

function fileSizeBytes(path: string): number {
  if (!existsSync(path)) return 0;
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

function normalizeSettings(raw: unknown): VideoContentStorageSettings {
  const o = (raw ?? {}) as Record<string, unknown>;
  const cap = Number(o.ssdCapGb);
  const warn = Number(o.warnPercent);
  const srcDays = Number(o.autoDeleteSourceDaysAfterUpload);
  const subDays = Number(o.autoDeleteSubtitledDays);
  return {
    ssdCapGb: cap > 0 ? cap : DEFAULT_VIDEO_CONTENT_STORAGE_SETTINGS.ssdCapGb,
    warnPercent:
      warn > 0 && warn <= 100 ? warn : DEFAULT_VIDEO_CONTENT_STORAGE_SETTINGS.warnPercent,
    autoCleanupEnabled: Boolean(o.autoCleanupEnabled),
    autoDeleteSourceDaysAfterUpload: srcDays >= 0 ? srcDays : 7,
    autoDeleteSubtitledDays: subDays >= 0 ? subDays : 90,
  };
}

export async function getVideoContentStorageSettings(): Promise<VideoContentStorageSettings> {
  const raw = await getSetting<unknown>(VIDEO_CONTENT_STORAGE_SETTING_KEY, DEFAULT_VIDEO_CONTENT_STORAGE_SETTINGS);
  return normalizeSettings(raw);
}

export async function updateVideoContentStorageSettings(
  patch: Partial<VideoContentStorageSettings>,
): Promise<VideoContentStorageSettings> {
  const current = await getVideoContentStorageSettings();
  const next = normalizeSettings({ ...current, ...patch });
  await updateSetting(VIDEO_CONTENT_STORAGE_SETTING_KEY, next);
  return next;
}

function allPlatformsUploaded(row: HistoryRow): boolean {
  return UPLOAD_PLATFORMS.every((p) => Boolean(row[`uploaded_${p}`]));
}

function latestUploadAt(row: HistoryRow): Date | null {
  const times = UPLOAD_PLATFORMS.map((p) => row[`uploaded_${p}_at`])
    .filter((v): v is string => typeof v === 'string' && v.length > 0)
    .map((v) => new Date(v).getTime())
    .filter((t) => Number.isFinite(t));
  if (!times.length) return null;
  return new Date(Math.max(...times));
}

function resolveFileState(row: HistoryRow): {
  subtitledPath: string;
  sourcePath: string;
  hasSubtitled: boolean;
  hasSource: boolean;
  subtitledBytes: number;
  sourceBytes: number;
} {
  const id = String(row.id);
  const subtitledPath = resolveStoredVideoPath(id, row.video_file_path as string | null | undefined, 'final');
  const sourcePath = resolveStoredVideoPath(id, row.source_video_path as string | null | undefined, 'source');
  const subtitledBytes = fileSizeBytes(subtitledPath);
  const sourceBytes = fileSizeBytes(sourcePath);
  return {
    subtitledPath,
    sourcePath,
    hasSubtitled: subtitledBytes > 0,
    hasSource: sourceBytes > 0,
    subtitledBytes,
    sourceBytes,
  };
}

function resolveDurationSec(row: HistoryRow): number | null {
  const fromCol = Number(row.duration);
  if (Number.isFinite(fromCol) && fromCol > 0) return Math.round(fromCol);

  const conti = row.conti_json as Record<string, unknown> | null | undefined;
  if (conti && typeof conti === 'object') {
    const fromConti = Number(conti.duration);
    if (Number.isFinite(fromConti) && fromConti > 0) return Math.round(fromConti);

    const shots = conti.shots as Array<{ endSec?: number }> | undefined;
    if (Array.isArray(shots) && shots.length > 0) {
      const lastEnd = shots[shots.length - 1]?.endSec;
      if (Number.isFinite(lastEnd) && lastEnd > 0) return Math.round(lastEnd);
    }
  }

  return null;
}

function rowToStorageItem(row: HistoryRow): VideoContentStorageItem | null {
  const files = resolveFileState(row);
  if (!files.hasSubtitled && !files.hasSource) return null;

  const created = new Date(String(row.created_at));
  const ageDays = Number.isFinite(created.getTime())
    ? Math.floor((Date.now() - created.getTime()) / (24 * 60 * 60 * 1000))
    : 0;
  const uploadAt = latestUploadAt(row);

  return {
    id: String(row.id),
    account_id: String(row.account_id),
    workspace: String(row.workspace),
    status: String(row.status),
    scenario_summary: row.scenario_summary ? String(row.scenario_summary) : null,
    created_at: String(row.created_at),
    similarity_score:
      row.similarity_score != null && row.similarity_score !== ''
        ? Number(row.similarity_score)
        : null,
    hasSubtitled: files.hasSubtitled,
    hasSource: files.hasSource,
    subtitledBytes: files.subtitledBytes,
    sourceBytes: files.sourceBytes,
    totalBytes: files.subtitledBytes + files.sourceBytes,
    allPlatformsUploaded: allPlatformsUploaded(row),
    latestUploadAt: uploadAt?.toISOString() ?? null,
    ageDays,
    durationSec: resolveDurationSec(row),
  };
}

async function loadStorageRows(allowedWorkspaces: string[]): Promise<HistoryRow[]> {
  let query = supabase
    .from('huma_video_content_history')
    .select(
      'id, account_id, workspace, status, scenario_summary, similarity_score, duration, conti_json, created_at, video_file_path, source_video_path, uploaded_youtube, uploaded_youtube_at, uploaded_tiktok, uploaded_tiktok_at, uploaded_instagram, uploaded_instagram_at, uploaded_threads, uploaded_threads_at, uploaded_x, uploaded_x_at',
    )
    .in('workspace', allowedWorkspaces)
    .order('created_at', { ascending: false })
    .limit(500);

  const { data } = await query;
  return (data ?? []) as HistoryRow[];
}

export async function getVideoContentStorageStats(params: {
  allowedWorkspaces: string[];
}): Promise<VideoContentStorageStats> {
  const settings = await getVideoContentStorageSettings();
  const rows = await loadStorageRows(params.allowedWorkspaces);

  let subtitledBytes = 0;
  let sourceBytes = 0;
  let withBothCount = 0;
  let subtitledOnlyCount = 0;
  let sourceOnlyCount = 0;
  let completedCount = 0;
  let reclaimableSourceBytes = 0;
  let reclaimableSourceCount = 0;

  for (const row of rows) {
    if (row.status === 'completed') completedCount += 1;
    const files = resolveFileState(row);
    if (!files.hasSubtitled && !files.hasSource) continue;

    subtitledBytes += files.subtitledBytes;
    sourceBytes += files.sourceBytes;

    if (files.hasSubtitled && files.hasSource) withBothCount += 1;
    else if (files.hasSubtitled) subtitledOnlyCount += 1;
    else if (files.hasSource) sourceOnlyCount += 1;

    if (files.hasSource && allPlatformsUploaded(row)) {
      reclaimableSourceBytes += files.sourceBytes;
      reclaimableSourceCount += 1;
    }
  }

  const totalBytes = subtitledBytes + sourceBytes;
  const capBytes = settings.ssdCapGb * 1024 * 1024 * 1024;
  const usedPercent = capBytes > 0 ? Math.min(100, Math.round((totalBytes / capBytes) * 100)) : 0;
  let warnLevel: VideoContentStorageStats['warnLevel'] = 'ok';
  if (usedPercent >= 95) warnLevel = 'critical';
  else if (usedPercent >= settings.warnPercent) warnLevel = 'warn';

  return {
    totalBytes,
    subtitledBytes,
    sourceBytes,
    completedCount,
    withBothCount,
    subtitledOnlyCount,
    sourceOnlyCount,
    usedPercent,
    warnLevel,
    ssdCapGb: settings.ssdCapGb,
    warnPercent: settings.warnPercent,
    reclaimableSourceBytes,
    reclaimableSourceCount,
  };
}

function matchesFilter(item: VideoContentStorageItem, filter: StorageListFilter): boolean {
  switch (filter) {
    case 'uploaded_with_source':
      return item.allPlatformsUploaded && item.hasSource;
    case 'older_than_30':
      return item.ageDays >= 30 && (item.hasSubtitled || item.hasSource);
    case 'failed_or_hold':
      return item.status === 'failed' || item.status === 'on_hold';
    case 'all_with_files':
    default:
      return item.hasSubtitled || item.hasSource;
  }
}

export async function listVideoContentStorageItems(params: {
  allowedWorkspaces: string[];
  filter?: StorageListFilter;
}): Promise<VideoContentStorageItem[]> {
  const rows = await loadStorageRows(params.allowedWorkspaces);
  const filter = params.filter ?? 'all_with_files';
  const items: VideoContentStorageItem[] = [];
  for (const row of rows) {
    const item = rowToStorageItem(row);
    if (!item) continue;
    if (matchesFilter(item, filter)) items.push(item);
  }
  return items.sort((a, b) => b.totalBytes - a.totalBytes);
}

export async function deleteVideoContentFileForHistory(params: {
  historyId: string;
  target: 'source' | 'subtitled';
  videoFilePath?: string | null;
  sourceVideoPath?: string | null;
}): Promise<void> {
  const { historyId, target } = params;
  if (target === 'source') {
    const path = params.sourceVideoPath || videoContentSourcePath(historyId);
    if (existsSync(path)) await unlink(path).catch(() => {});
    await removeVideoContentThumb(historyId, 'source');
    await supabase.from('huma_video_content_history').update({ source_video_path: null }).eq('id', historyId);
    return;
  }
  const path = params.videoFilePath || videoContentFinalPath(historyId);
  if (existsSync(path)) await unlink(path).catch(() => {});
  await removeVideoContentThumb(historyId, 'subtitled');
  await supabase.from('huma_video_content_history').update({ video_file_path: null }).eq('id', historyId);
}

export async function bulkDeleteVideoContentFiles(params: {
  ids: string[];
  target: 'source' | 'subtitled';
  allowedWorkspaces: string[];
}): Promise<{ deleted: number; freedBytes: number }> {
  if (!params.ids.length) return { deleted: 0, freedBytes: 0 };

  const { data: rows } = await supabase
    .from('huma_video_content_history')
    .select('id, workspace, video_file_path, source_video_path')
    .in('id', params.ids);

  let deleted = 0;
  let freedBytes = 0;

  for (const row of rows ?? []) {
    if (!params.allowedWorkspaces.includes(String(row.workspace))) continue;
    const files = resolveFileState(row as HistoryRow);
    const bytes = params.target === 'source' ? files.sourceBytes : files.subtitledBytes;
    if (bytes <= 0) continue;

    await deleteVideoContentFileForHistory({
      historyId: String(row.id),
      target: params.target,
      videoFilePath: row.video_file_path,
      sourceVideoPath: row.source_video_path,
    });
    deleted += 1;
    freedBytes += bytes;
  }

  return { deleted, freedBytes };
}

export async function runVideoContentStorageAutoCleanup(): Promise<{
  deletedSources: number;
  deletedSubtitled: number;
  freedBytes: number;
}> {
  const settings = await getVideoContentStorageSettings();
  if (!settings.autoCleanupEnabled) {
    return { deletedSources: 0, deletedSubtitled: 0, freedBytes: 0 };
  }

  const { data: rows } = await supabase
    .from('huma_video_content_history')
    .select(
      'id, workspace, status, created_at, video_file_path, source_video_path, uploaded_youtube, uploaded_youtube_at, uploaded_tiktok, uploaded_tiktok_at, uploaded_instagram, uploaded_instagram_at, uploaded_threads, uploaded_threads_at, uploaded_x, uploaded_x_at',
    )
    .in('status', ['completed', 'failed', 'on_hold'])
    .limit(1000);

  const now = Date.now();
  let deletedSources = 0;
  let deletedSubtitled = 0;
  let freedBytes = 0;

  for (const row of (rows ?? []) as HistoryRow[]) {
    const files = resolveFileState(row);
    const workspace = row.workspace as Workspace;

    if (
      settings.autoDeleteSourceDaysAfterUpload > 0 &&
      files.hasSource &&
      allPlatformsUploaded(row)
    ) {
      const uploadAt = latestUploadAt(row);
      if (uploadAt) {
        const cutoff = uploadAt.getTime() + settings.autoDeleteSourceDaysAfterUpload * 24 * 60 * 60 * 1000;
        if (now >= cutoff) {
          await deleteVideoContentFileForHistory({
            historyId: String(row.id),
            target: 'source',
            sourceVideoPath: row.source_video_path as string | null,
          });
          deletedSources += 1;
          freedBytes += files.sourceBytes;
          continue;
        }
      }
    }

    if (
      settings.autoDeleteSubtitledDays > 0 &&
      row.status === 'completed' &&
      files.hasSubtitled
    ) {
      const created = new Date(String(row.created_at)).getTime();
      const cutoff = created + settings.autoDeleteSubtitledDays * 24 * 60 * 60 * 1000;
      if (Number.isFinite(created) && now >= cutoff) {
        await deleteVideoContentFileForHistory({
          historyId: String(row.id),
          target: 'subtitled',
          videoFilePath: row.video_file_path as string | null,
        });
        deletedSubtitled += 1;
        freedBytes += files.subtitledBytes;
      }
    }
  }

  if (deletedSources > 0 || deletedSubtitled > 0) {
    await logOperation({
      level: 'info',
      message: `[video-content] SSD 자동 정리 — 원본 ${deletedSources}건, 자막본 ${deletedSubtitled}건, ${Math.round(freedBytes / 1024 / 1024)}MB`,
    });
  }

  return { deletedSources, deletedSubtitled, freedBytes };
}

export function formatStorageBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}
