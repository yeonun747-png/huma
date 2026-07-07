import { supabase } from '../../middleware/auth.js';
import type { NarrationScriptWorkspace } from '@huma/shared';
import { generateNarrationScript } from './generator.js';
import { planFromNarrationHistoryRow, planNarrationPick, type PlanNarrationPickInput } from './pick-plan.js';
import {
  initialNarrationProgressMeta,
  markNarrationScriptFailed,
  NARRATION_GENERATION_TIMEOUT_MS,
  recoverStaleNarrationScripts,
  reportNarrationProgress,
} from './progress.js';
import {
  assertNarrationScriptNotCancelled,
  isNarrationScriptCancelledError,
  NARRATION_SCRIPT_CANCEL_MESSAGE,
} from './cancel.js';

export { recoverStaleNarrationScripts };

export async function createNarrationScriptJob(
  input: PlanNarrationPickInput,
): Promise<string> {
  const plan = await planNarrationPick(input);

  const { data, error } = await supabase
    .from('huma_narration_script_history')
    .insert({
      workspace: plan.workspace,
      format_type: plan.formatType,
      axis_type: plan.axisType,
      topic_key: plan.topic.key,
      topic_label: plan.topic.label,
      title: '',
      script_body: '',
      status: 'script_generating',
      source_meta: initialNarrationProgressMeta({ pick: plan.combo }),
    })
    .select('id')
    .single();

  if (error || !data) throw new Error(error?.message ?? '나레이션 이력 생성 실패');
  return data.id as string;
}

function withGenerationTimeout<T>(promise: Promise<T>, historyId: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(
          `나레이션 대본 생성 시간 초과(${Math.round(NARRATION_GENERATION_TIMEOUT_MS / 60_000)}분)`,
        ),
      );
    }, NARRATION_GENERATION_TIMEOUT_MS);

    promise
      .then(resolve)
      .catch(reject)
      .finally(() => clearTimeout(timer));
  });
}

export async function runNarrationScriptGeneration(historyId: string): Promise<void> {
  const id = historyId?.trim();
  if (!id) {
    throw new Error('나레이션 historyId 없음 — 큐 payload 오류');
  }

  try {
    await withGenerationTimeout(runNarrationScriptGenerationInner(id), id);
  } catch (err) {
    if (isNarrationScriptCancelledError(err)) return;
    const msg = (err as Error).message;
    if (msg !== NARRATION_SCRIPT_CANCEL_MESSAGE) {
      await markNarrationScriptFailed(id, msg);
    }
    throw err;
  }
}

async function runNarrationScriptGenerationInner(historyId: string): Promise<void> {
  const { data: row, error } = await supabase
    .from('huma_narration_script_history')
    .select('*')
    .eq('id', historyId)
    .maybeSingle();

  if (error || !row) throw new Error(error?.message ?? '나레이션 이력 없음');
  if (row.status !== 'script_generating') return;

  const workspace = row.workspace as NarrationScriptWorkspace;

  await reportNarrationProgress(historyId, workspace, 'worker_start');
  await assertNarrationScriptNotCancelled(historyId);
  await reportNarrationProgress(historyId, workspace, 'plan_pick');

  const plan = await planFromNarrationHistoryRow({
    workspace,
    format_type: row.format_type as PlanNarrationPickInput['formatType'],
    axis_type: row.axis_type as PlanNarrationPickInput['axisType'],
    topic_key: String(row.topic_key),
    topic_label: String(row.topic_label),
  });

  await assertNarrationScriptNotCancelled(historyId);

  try {
    const generated = await generateNarrationScript(plan, {
      historyId,
      workspace,
    });
    const meta = (row.source_meta as Record<string, unknown>) ?? {};
    await reportNarrationProgress(historyId, workspace, 'saving');
    await supabase
      .from('huma_narration_script_history')
      .update({
        title: generated.title,
        script_body: generated.scriptBody,
        status: 'script_ready',
        error_message: null,
        source_meta: { ...meta, model: generated.model, generated_at: new Date().toISOString() },
        updated_at: new Date().toISOString(),
      })
      .eq('id', historyId)
      .eq('status', 'script_generating');
  } catch (err) {
    if (isNarrationScriptCancelledError(err)) return;
    const msg = (err as Error).message;
    if (msg !== NARRATION_SCRIPT_CANCEL_MESSAGE) {
      await markNarrationScriptFailed(historyId, msg);
    }
    throw err;
  }
}
