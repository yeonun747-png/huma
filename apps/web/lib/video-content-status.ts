import type { HumaVideoContentHistory } from '@huma/shared';

export type VideoContentTab = 'review' | 'progress' | 'done' | 'failed';

export const VIDEO_CONTENT_LIST_PAGE_SIZE = 5;

export function listPageSizeForVideoContentTab(_tab: VideoContentTab): number {
  return VIDEO_CONTENT_LIST_PAGE_SIZE;
}

export function paginateList<T>(items: T[], page: number, pageSize = VIDEO_CONTENT_LIST_PAGE_SIZE): T[] {
  if (pageSize <= 0 || !items.length) return [];
  const safePage = Math.max(1, page);
  const start = (safePage - 1) * pageSize;
  return items.slice(start, start + pageSize);
}

export function listTotalPages(count: number, pageSize = VIDEO_CONTENT_LIST_PAGE_SIZE): number {
  if (pageSize <= 0) return 1;
  return Math.max(1, Math.ceil(count / pageSize));
}

/** 경과 초 → "42초" / "3분 12초" / "1시간 5분" */
export function formatElapsedDurationSec(totalSec: number): string {
  const sec = Math.max(0, Math.floor(totalSec));
  if (sec < 60) return `${sec}초`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m < 60) return s > 0 ? `${m}분 ${s}초` : `${m}분`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm > 0 ? `${h}시간 ${rm}분` : `${h}시간`;
}

export function elapsedSecSince(iso: string | null | undefined, nowMs = Date.now()): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((nowMs - t) / 1000));
}

/** 진행 중 작업 — 경과 표시 기준 시각 (콘티=created_at, 렌더=videoRenderStartedAt) */
export function resolveVideoContentProgressSince(
  item: Pick<HumaVideoContentHistory, 'status' | 'created_at' | 'conti_json' | 'progress_since_at'>,
): string | undefined {
  if (!isVideoProgressStatus(item.status)) return undefined;
  if (item.progress_since_at) return item.progress_since_at;
  if (item.status === 'conti_generating') return item.created_at;
  const renderStarted = item.conti_json?.videoRenderStartedAt;
  if (typeof renderStarted === 'string' && renderStarted.trim()) return renderStarted;
  return item.created_at;
}

export const VIDEO_CONTENT_TAB_LABEL: Record<VideoContentTab, string> = {
  review: '검토 대기',
  progress: '진행 중',
  done: '완료',
  failed: '실패·보류',
};

const TAB_STATUSES: Record<VideoContentTab, string[]> = {
  review: ['conti_ready'],
  progress: ['conti_generating', 'rendering', 'generating'],
  done: ['completed'],
  failed: ['failed', 'on_hold'],
};

export function videoContentTabOf(status: string): VideoContentTab {
  if (TAB_STATUSES.review.includes(status)) return 'review';
  if (TAB_STATUSES.progress.includes(status)) return 'progress';
  if (TAB_STATUSES.done.includes(status)) return 'done';
  return 'failed';
}

export function filterByVideoContentTab(
  items: HumaVideoContentHistory[],
  tab: VideoContentTab,
): HumaVideoContentHistory[] {
  const allowed = TAB_STATUSES[tab];
  return items.filter((item) => allowed.includes(item.status));
}

export function countByVideoContentTab(items: HumaVideoContentHistory[]): Record<VideoContentTab, number> {
  return {
    review: items.filter((i) => TAB_STATUSES.review.includes(i.status)).length,
    progress: items.filter((i) => TAB_STATUSES.progress.includes(i.status)).length,
    done: items.filter((i) => TAB_STATUSES.done.includes(i.status)).length,
    failed: items.filter((i) => TAB_STATUSES.failed.includes(i.status)).length,
  };
}

const DELETABLE_STATUSES = ['conti_ready', 'completed', 'failed', 'on_hold'] as const;

export const VIDEO_PROGRESS_STATUSES = ['conti_generating', 'rendering', 'generating'] as const;

export function isVideoProgressStatus(status: string): boolean {
  return (VIDEO_PROGRESS_STATUSES as readonly string[]).includes(status);
}

export function isDeletableVideoContent(status: string): boolean {
  return (DELETABLE_STATUSES as readonly string[]).includes(status);
}

export const EDITABLE_CONTI_DIALOGUE_STATUSES = [
  'conti_ready',
  'on_hold',
  'failed',
  'completed',
] as const;

export function canEditContiDialogues(status: string): boolean {
  return (EDITABLE_CONTI_DIALOGUE_STATUSES as readonly string[]).includes(status);
}

export const VIDEO_CONTENT_STATUS_LABEL: Record<string, string> = {
  conti_generating: '콘티 작성 중',
  conti_ready: '검토 대기',
  rendering: '영상 제작 중',
  generating: '영상 제작 중',
  completed: '완료',
  failed: '실패',
  on_hold: '보류',
};

export function formatSelfAssessedHumor(humor?: string | null): string {
  if (humor === 'funny') return 'funny';
  if (humor === 'dull') return 'dull';
  return '—';
}

export function isDullHumorAssessment(humor?: string | null): boolean {
  return humor === 'dull';
}

export interface ContiPreviewData {
  scenarioSummary?: string;
  location?: string;
  lighting?: string;
  timeOfDay?: string;
  cutType?: string;
  duration?: number;
  characters?: Array<{ label: string; age?: string; gender?: string; hair?: string; outfit?: string }>;
  shots?: Array<{
    shotNumber?: number;
    startSec?: number;
    endSec?: number;
    camera?: string;
    action?: string;
    dialogue?: string;
  }>;
  evolinkPrompt?: string;
}

export function parseContiPreview(raw: unknown): ContiPreviewData | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  return {
    scenarioSummary: String(obj.scenarioSummary ?? ''),
    location: String(obj.location ?? ''),
    lighting: String(obj.lighting ?? ''),
    timeOfDay: String(obj.timeOfDay ?? ''),
    cutType: String(obj.cutType ?? ''),
    duration: Number(obj.duration) || undefined,
    characters: (obj.characters as ContiPreviewData['characters']) ?? [],
    shots: (obj.shots as ContiPreviewData['shots']) ?? [],
    evolinkPrompt: obj.evolinkPrompt ? String(obj.evolinkPrompt) : undefined,
  };
}
