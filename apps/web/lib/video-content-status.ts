import type { HumaVideoContentHistory } from '@huma/shared';

export type VideoContentTab = 'review' | 'progress' | 'done' | 'failed';

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

export const VIDEO_CONTENT_STATUS_LABEL: Record<string, string> = {
  conti_generating: '콘티 작성 중',
  conti_ready: '검토 대기',
  rendering: '영상 제작 중',
  generating: '영상 제작 중',
  completed: '완료',
  failed: '실패',
  on_hold: '보류',
};

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
