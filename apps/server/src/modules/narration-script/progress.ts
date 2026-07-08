import { supabase } from '../../middleware/auth.js';
import { logOperation } from '../../lib/log-emitter.js';

export const NARRATION_PROGRESS_STAGES = {
  queue_start: { percent: 2, label: '큐 등록 · 생성 대기' },
  worker_start: { percent: 5, label: '워커 처리 시작' },
  plan_pick: { percent: 8, label: '주제·축 조합 확인' },
  llm_write: { percent: 10, label: 'Sonnet 대본 작성 중…' },
  llm_retry: { percent: 72, label: '대본 재작성 중…' },
  validate: { percent: 88, label: '길이·형식 검증' },
  intro_append: { percent: 91, label: '댓글 유도 문구 추가' },
  cta_append: { percent: 93, label: 'CTA 문구 추가' },
  saving: { percent: 97, label: '저장 중' },
} as const;

export type NarrationProgressStage = keyof typeof NARRATION_PROGRESS_STAGES;

/** Sonnet 1회 호출 타임아웃 — env NARRATION_LLM_TIMEOUT_MS (기본 5분) */
export const NARRATION_LLM_TIMEOUT_MS = (() => {
  const raw = Number(process.env.NARRATION_LLM_TIMEOUT_MS);
  return Number.isFinite(raw) && raw >= 60_000 ? raw : 300_000;
})();

/** LLM 구간 시간 기반 진행률 (전체 0~100% 기준) */
export const NARRATION_LLM_PROGRESS_BAND = {
  write: { start: 10, end: 78 },
  retry: { start: 72, end: 88 },
} as const;

/** LLM 5분×2 + 검증·저장 여유 — 초과 시 stuck 으로 간주 */
export const NARRATION_GENERATION_STALE_MS = 15 * 60 * 1000;

export const NARRATION_GENERATION_TIMEOUT_MS = 12 * 60 * 1000;

async function writeNarrationProgressMeta(
  historyId: string,
  stage: NarrationProgressStage,
  label: string,
  percent: number,
): Promise<Record<string, unknown>> {
  const clamped = Math.min(100, Math.max(0, Math.round(percent)));

  const { data: row } = await supabase
    .from('huma_narration_script_history')
    .select('source_meta')
    .eq('id', historyId)
    .maybeSingle();

  const meta = (row?.source_meta as Record<string, unknown>) ?? {};
  const since =
    typeof meta.progress_since_at === 'string' && meta.progress_since_at
      ? meta.progress_since_at
      : new Date().toISOString();

  const nextMeta = {
    ...meta,
    progress_stage: stage,
    progress_label: label,
    progress_percent: clamped,
    progress_since_at: since,
    progress_updated_at: new Date().toISOString(),
  };

  await supabase
    .from('huma_narration_script_history')
    .update({ source_meta: nextMeta, updated_at: new Date().toISOString() })
    .eq('id', historyId);

  return nextMeta;
}

export async function reportNarrationProgress(
  historyId: string,
  workspace: string,
  stage: NarrationProgressStage,
  labelOverride?: string,
): Promise<void> {
  const def = NARRATION_PROGRESS_STAGES[stage];
  const label = labelOverride ?? def.label;
  const percent = def.percent;

  await writeNarrationProgressMeta(historyId, stage, label, percent);

  await logOperation({
    level: 'info',
    message: `[narration-script] ${label} (${percent}%)`,
    workspace,
    metadata: {
      narration_script_history_id: historyId,
      progress_stage: stage,
      progress_percent: percent,
      progress_label: label,
    },
  });
}

/** LLM 대기 중 시간 기반 진행률 — DB만 갱신(heartbeat), emitLog 시 소켓·로그 */
export async function reportNarrationProgressPercent(
  historyId: string,
  workspace: string,
  stage: NarrationProgressStage,
  percent: number,
  label: string,
  opts?: { emitLog?: boolean },
): Promise<void> {
  const clamped = Math.min(100, Math.max(0, Math.round(percent)));
  await writeNarrationProgressMeta(historyId, stage, label, clamped);

  if (opts?.emitLog) {
    await logOperation({
      level: 'info',
      message: `[narration-script] ${label} (${clamped}%)`,
      workspace,
      metadata: {
        narration_script_history_id: historyId,
        progress_stage: stage,
        progress_percent: clamped,
        progress_label: label,
      },
    });
  }
}

export function initialNarrationProgressMeta(
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  const now = new Date().toISOString();
  return {
    ...extra,
    progress_stage: 'queue_start',
    progress_label: NARRATION_PROGRESS_STAGES.queue_start.label,
    progress_percent: NARRATION_PROGRESS_STAGES.queue_start.percent,
    progress_since_at: now,
    progress_updated_at: now,
  };
}

export async function markNarrationScriptFailed(
  historyId: string,
  message: string,
): Promise<void> {
  if (!historyId.trim()) return;
  await supabase
    .from('huma_narration_script_history')
    .update({
      status: 'failed',
      error_message: message.slice(0, 500),
      updated_at: new Date().toISOString(),
    })
    .eq('id', historyId)
    .eq('status', 'script_generating');
}

export async function recoverStaleNarrationScripts(
  workspace?: string,
): Promise<number> {
  const cutoff = new Date(Date.now() - NARRATION_GENERATION_STALE_MS).toISOString();
  let query = supabase
    .from('huma_narration_script_history')
    .select('id, workspace')
    .eq('status', 'script_generating')
    .lt('updated_at', cutoff);

  if (workspace?.trim()) {
    query = query.eq('workspace', workspace.trim());
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  if (!data?.length) return 0;

  const staleMessage =
    '생성 시간 초과(15분) — 큐 미처리 또는 LLM 지연. 다시 시도해 주세요.';

  for (const row of data) {
    await markNarrationScriptFailed(String(row.id), staleMessage);
    await logOperation({
      level: 'warn',
      message: `[narration-script] stuck 정리 — history=${row.id}`,
      workspace: String(row.workspace ?? ''),
      metadata: { narration_script_history_id: row.id },
    });
  }

  return data.length;
}
