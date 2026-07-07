import { supabase } from '../../middleware/auth.js';
import type { NarrationScriptWorkspace } from '@huma/shared';
import { generateNarrationScript } from './generator.js';
import { planNarrationPick, type PlanNarrationPickInput } from './pick-plan.js';
import { initialNarrationProgressMeta, reportNarrationProgress } from './progress.js';

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

export async function runNarrationScriptGeneration(historyId: string): Promise<void> {
  const { data: row, error } = await supabase
    .from('huma_narration_script_history')
    .select('*')
    .eq('id', historyId)
    .maybeSingle();

  if (error || !row) throw new Error(error?.message ?? '나레이션 이력 없음');
  if (row.status !== 'script_generating') return;

  const workspace = row.workspace as NarrationScriptWorkspace;

  await reportNarrationProgress(historyId, workspace, 'plan_pick');

  const plan = await planNarrationPick({
    workspace,
    formatType: row.format_type as PlanNarrationPickInput['formatType'],
    axisType: row.axis_type as PlanNarrationPickInput['axisType'],
    topicKey: row.topic_key as string,
  });

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
      .eq('id', historyId);
  } catch (err) {
    const msg = (err as Error).message;
    await supabase
      .from('huma_narration_script_history')
      .update({
        status: 'failed',
        error_message: msg.slice(0, 500),
        updated_at: new Date().toISOString(),
      })
      .eq('id', historyId);
    throw err;
  }
}
