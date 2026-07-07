import { supabase } from '../../middleware/auth.js';
import { logOperation } from '../../lib/log-emitter.js';

export const NARRATION_PROGRESS_STAGES = {
  queue_start: { percent: 5, label: '큐 등록 · 생성 대기' },
  plan_pick: { percent: 15, label: '주제·축 조합 확인' },
  llm_write: { percent: 40, label: 'Sonnet 대본 작성 중…' },
  llm_retry: { percent: 55, label: '대본 재작성 중…' },
  validate: { percent: 75, label: '길이·형식 검증' },
  cta_append: { percent: 90, label: 'CTA 문구 추가' },
  saving: { percent: 95, label: '저장 중' },
} as const;

export type NarrationProgressStage = keyof typeof NARRATION_PROGRESS_STAGES;

export async function reportNarrationProgress(
  historyId: string,
  workspace: string,
  stage: NarrationProgressStage,
  labelOverride?: string,
): Promise<void> {
  const def = NARRATION_PROGRESS_STAGES[stage];
  const label = labelOverride ?? def.label;
  const percent = def.percent;

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
    progress_percent: percent,
    progress_since_at: since,
    progress_updated_at: new Date().toISOString(),
  };

  await supabase
    .from('huma_narration_script_history')
    .update({ source_meta: nextMeta, updated_at: new Date().toISOString() })
    .eq('id', historyId);

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
