import { supabase } from '../../middleware/auth.js';
import { logOperation } from '../../lib/log-emitter.js';
import { humaQueue } from '../queue/producer.js';

export const NARRATION_SCRIPT_CANCEL_MESSAGE = '대본 생성 중지 (사용자 요청)';

export function narrationScriptQueueJobId(historyId: string): string {
  return `narration-script-${historyId.trim()}`;
}

export class NarrationScriptCancelledError extends Error {
  readonly historyId: string;

  constructor(historyId: string) {
    super(NARRATION_SCRIPT_CANCEL_MESSAGE);
    this.name = 'NarrationScriptCancelledError';
    this.historyId = historyId;
  }
}

export function isNarrationScriptCancelledError(err: unknown): err is NarrationScriptCancelledError {
  return err instanceof NarrationScriptCancelledError;
}

export async function assertNarrationScriptNotCancelled(historyId: string): Promise<void> {
  const { data } = await supabase
    .from('huma_narration_script_history')
    .select('status')
    .eq('id', historyId)
    .maybeSingle();

  if (!data || data.status !== 'script_generating') {
    throw new NarrationScriptCancelledError(historyId);
  }
}

export async function removeNarrationScriptQueueJob(historyId: string): Promise<void> {
  try {
    const job = await humaQueue.getJob(narrationScriptQueueJobId(historyId));
    if (!job) return;
    const state = await job.getState();
    if (state === 'waiting' || state === 'delayed' || state === 'paused') {
      await job.remove();
    }
  } catch {
    /* 큐 미연결·이미 처리 중 */
  }
}

export async function cancelNarrationScriptJob(historyId: string): Promise<
  | { ok: true; previousStatus: string }
  | { ok: false; error: string; statusCode: number }
> {
  const id = historyId.trim();
  if (!id) return { ok: false, error: 'id 없음', statusCode: 400 };

  const { data: row, error } = await supabase
    .from('huma_narration_script_history')
    .select('id, status, workspace')
    .eq('id', id)
    .maybeSingle();

  if (error) return { ok: false, error: error.message, statusCode: 500 };
  if (!row) return { ok: false, error: '없음', statusCode: 404 };

  const previousStatus = String(row.status);
  if (previousStatus !== 'script_generating') {
    return { ok: false, error: `중지할 수 없는 상태: ${previousStatus}`, statusCode: 409 };
  }

  const { error: updateErr } = await supabase
    .from('huma_narration_script_history')
    .update({
      status: 'failed',
      error_message: NARRATION_SCRIPT_CANCEL_MESSAGE,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('status', 'script_generating');

  if (updateErr) return { ok: false, error: updateErr.message, statusCode: 500 };

  await removeNarrationScriptQueueJob(id);

  await logOperation({
    level: 'warn',
    message: `[narration-script] 대본 생성 중지 — history=${id}`,
    workspace: String(row.workspace),
    metadata: { narration_script_history_id: id, cancelled_from: previousStatus },
  });

  return { ok: true, previousStatus };
}
