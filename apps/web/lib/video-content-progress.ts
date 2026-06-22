import type { HumaVideoContentHistory } from '@huma/shared';
import { isVideoProgressStatus } from './video-content-status';

export type VideoContentLogPayload = {
  message?: string | null;
  metadata?: Record<string, unknown> | null;
  account_id?: string | null;
};

const SKIP_STAGE_PATTERNS = [
  /^Sonnet\/Haiku 토큰/,
  /^콘티 생성 시작$/,
  /^embedding/,
  /^유사도 검사/,
];

/** huma_logs / socket — [video-content] 진행 단계 추출 */
export function parseVideoContentProgressStage(payload: VideoContentLogPayload): {
  historyId?: string;
  stage: string;
} | null {
  const msg = String(payload.message ?? '').trim();
  if (!msg.startsWith('[video-content]')) return null;

  let historyId: string | undefined;
  const metaId = payload.metadata?.video_content_history_id;
  if (typeof metaId === 'string' && metaId) historyId = metaId;

  const histInMsg = msg.match(/history=([0-9a-f-]{36})/i);
  if (histInMsg) historyId = histInMsg[1];

  let stage = msg.replace(/^\[video-content\]\s*/, '').trim();
  stage = stage.replace(/\s*—\s*history=[0-9a-f-]{36}/i, '').trim();
  stage = stage.replace(/\shistory=[0-9a-f-]{36}\s*$/i, '').trim();

  if (!stage || SKIP_STAGE_PATTERNS.some((re) => re.test(stage))) return null;
  return { historyId, stage };
}

export function resolveVideoContentProgressHistoryId(params: {
  payload: VideoContentLogPayload;
  parsed: { historyId?: string; stage: string };
  items: HumaVideoContentHistory[];
  selectedId: string | null;
}): string | null {
  if (params.parsed.historyId) return params.parsed.historyId;
  const accountId = params.payload.account_id;
  if (!accountId) return null;

  const inProgress = params.items.filter(
    (i) => i.account_id === accountId && isVideoProgressStatus(i.status),
  );
  if (!inProgress.length) return null;
  if (params.selectedId && inProgress.some((i) => i.id === params.selectedId)) {
    return params.selectedId;
  }
  if (inProgress.length === 1) return inProgress[0]!.id;
  return null;
}
