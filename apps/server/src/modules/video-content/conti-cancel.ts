import { supabase } from '../../middleware/auth.js';
import { logOperation } from '../../lib/log-emitter.js';

export const VIDEO_CONTENT_IN_PROGRESS_STATUSES = ['conti_generating', 'rendering', 'generating'] as const;

export type VideoContentInProgressStatus = (typeof VIDEO_CONTENT_IN_PROGRESS_STATUSES)[number];

export function isVideoContentInProgress(status: string): status is VideoContentInProgressStatus {
  return (VIDEO_CONTENT_IN_PROGRESS_STATUSES as readonly string[]).includes(status);
}

export class VideoContentCancelledError extends Error {
  readonly historyId: string;

  constructor(historyId: string) {
    super('영상 콘티 작업이 중지되었습니다');
    this.name = 'VideoContentCancelledError';
    this.historyId = historyId;
  }
}

function contiGenerationSecSince(createdAtIso: string): number {
  const t = new Date(createdAtIso).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.round((Date.now() - t) / 1000));
}

/** DB status가 진행 중이 아니면 중지된 것으로 간주 (UI 중지·stale 정리 포함) */
export async function assertVideoContentNotCancelled(historyId: string): Promise<void> {
  const { data } = await supabase
    .from('huma_video_content_history')
    .select('status')
    .eq('id', historyId)
    .maybeSingle();

  if (!data || !isVideoContentInProgress(String(data.status))) {
    throw new VideoContentCancelledError(historyId);
  }
}

export async function cancelVideoContentJob(historyId: string): Promise<
  | { ok: true; previousStatus: string }
  | { ok: false; error: string; statusCode: number }
> {
  const { data: row, error } = await supabase
    .from('huma_video_content_history')
    .select('id, status, account_id, workspace, created_at')
    .eq('id', historyId)
    .maybeSingle();

  if (error) return { ok: false, error: error.message, statusCode: 500 };
  if (!row) return { ok: false, error: '없음', statusCode: 404 };

  const previousStatus = String(row.status);
  if (!isVideoContentInProgress(previousStatus)) {
    return { ok: false, error: `중지할 수 없는 상태: ${previousStatus}`, statusCode: 409 };
  }

  const patch: Record<string, unknown> = {
    status: 'failed',
    error_message: '작업 중지 (관리자 요청)',
  };
  if (previousStatus === 'conti_generating') {
    patch.conti_generation_sec = contiGenerationSecSince(String(row.created_at));
  }

  const { error: updateErr } = await supabase
    .from('huma_video_content_history')
    .update(patch)
    .eq('id', historyId);

  if (updateErr) return { ok: false, error: updateErr.message, statusCode: 500 };

  await logOperation({
    level: 'warn',
    message: `[video-content] 작업 중지 — history=${historyId} (이전 ${previousStatus})`,
    workspace: String(row.workspace),
    account_id: String(row.account_id),
    metadata: { video_content_history_id: historyId, cancelled_from: previousStatus },
  });

  return { ok: true, previousStatus };
}
