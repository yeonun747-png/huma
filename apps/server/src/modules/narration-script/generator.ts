import { askClaudeWithModel } from '../../lib/anthropic-client.js';
import { getMainClaudeModel } from '../../lib/ai-engine.js';
import { parseLlmJsonBlock } from '../../lib/llm-json.js';
import type { NarrationPickPlan } from './pick-plan.js';
import { appendNarrationScriptFooter } from './cta-templates.js';
import {
  buildFullCoverPrompt,
  buildRankedPrompt,
  sanitizeNarrationDraft,
  validateNarrationDraft,
  type GeneratedNarrationDraft,
} from './validation.js';
import { buildFallbackNarrationTitle } from './format.js';
import { NARRATION_WORKSPACE_LABEL, type NarrationScriptWorkspace } from '@huma/shared';
import {
  NARRATION_LLM_PROGRESS_BAND,
  NARRATION_LLM_TIMEOUT_MS,
  reportNarrationProgress,
  reportNarrationProgressPercent,
} from './progress.js';
import { assertNarrationScriptNotCancelled } from './cancel.js';

const MAX_ATTEMPTS = 2;
const LLM_PROGRESS_HEARTBEAT_MS = 2_500;

export interface NarrationGenerateProgressCtx {
  historyId: string;
  workspace: NarrationScriptWorkspace;
}

function workspaceLabel(ws: NarrationPickPlan['workspace']): string {
  return NARRATION_WORKSPACE_LABEL[ws];
}

async function callNarrationLlm(prompt: string, feedback?: string): Promise<GeneratedNarrationDraft> {
  const model = await getMainClaudeModel();
  const userPrompt = feedback ? `${prompt}\n\n[재작성] ${feedback}` : prompt;
  const raw = await askClaudeWithModel({
    model,
    max_tokens: 2048,
    prompt: userPrompt,
    timeout_ms: NARRATION_LLM_TIMEOUT_MS,
  });
  if (!raw?.trim()) {
    throw new Error(
      'LLM 응답이 비어 있습니다 — ANTHROPIC_API_KEY·API 상태를 확인하세요',
    );
  }

  const parsed = parseLlmJsonBlock(raw) as { title?: unknown; body?: unknown; script?: unknown; narration?: unknown };
  const title = String(parsed.title ?? '').trim();
  const body = String(parsed.body ?? parsed.script ?? parsed.narration ?? '').trim();
  if (!body) throw new Error('LLM JSON에 body가 없습니다');
  return sanitizeNarrationDraft({ title, body });
}

async function callNarrationLlmWithProgress(
  prompt: string,
  feedback: string | undefined,
  progress: NarrationGenerateProgressCtx,
  attempt: number,
  formatLabel: string,
): Promise<GeneratedNarrationDraft> {
  const band = attempt === 0 ? NARRATION_LLM_PROGRESS_BAND.write : NARRATION_LLM_PROGRESS_BAND.retry;
  const stage = attempt === 0 ? 'llm_write' : 'llm_retry';
  const baseLabel =
    attempt === 0
      ? `Sonnet 대본 작성 중… (${formatLabel})`
      : `대본 재작성 중… (${attempt + 1}/${MAX_ATTEMPTS}회 · ${formatLabel})`;

  await reportNarrationProgressPercent(
    progress.historyId,
    progress.workspace,
    stage,
    band.start,
    baseLabel,
    { emitLog: true },
  );

  const started = Date.now();
  const heartbeat = setInterval(() => {
    void (async () => {
      try {
        await assertNarrationScriptNotCancelled(progress.historyId);
        const elapsed = Date.now() - started;
        const ratio = Math.min(0.94, elapsed / NARRATION_LLM_TIMEOUT_MS);
        const pct = Math.round(band.start + ratio * (band.end - band.start));
        await reportNarrationProgressPercent(
          progress.historyId,
          progress.workspace,
          stage,
          pct,
          baseLabel,
        );
      } catch {
        /* cancelled or transient — heartbeat stops on throw from outer flow */
      }
    })();
  }, LLM_PROGRESS_HEARTBEAT_MS);

  try {
    return await callNarrationLlm(prompt, feedback);
  } finally {
    clearInterval(heartbeat);
    await reportNarrationProgressPercent(
      progress.historyId,
      progress.workspace,
      stage,
      band.end,
      baseLabel,
      { emitLog: true },
    );
  }
}

export async function generateNarrationScript(
  plan: NarrationPickPlan,
  progress?: NarrationGenerateProgressCtx,
): Promise<{
  title: string;
  scriptBody: string;
  model: string;
}> {
  const model = await getMainClaudeModel();
  const basePrompt =
    plan.formatType === 'full_cover'
      ? buildFullCoverPrompt({
          topicLabel: plan.topic.label,
          topicContext: plan.topic.contextText,
          axisType: plan.axisType,
          workspaceLabel: workspaceLabel(plan.workspace),
          periodType: plan.periodType,
          dateContext: plan.dateContext,
        })
      : buildRankedPrompt({
          topicLabel: plan.topic.label,
          topicContext: plan.topic.contextText,
          axisType: plan.axisType,
          workspaceLabel: workspaceLabel(plan.workspace),
          periodType: plan.periodType,
          dateContext: plan.dateContext,
        });

  const formatLabel = `${plan.formatType === 'ranked' ? '순위특집' : '전체커버'}·${plan.periodType}`;

  let feedback: string | undefined;
  let draft: GeneratedNarrationDraft | null = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (progress) {
      await assertNarrationScriptNotCancelled(progress.historyId);
    }

    draft = progress
      ? await callNarrationLlmWithProgress(basePrompt, feedback, progress, attempt, formatLabel)
      : await callNarrationLlm(basePrompt, feedback);

    if (progress) {
      await reportNarrationProgress(progress.historyId, progress.workspace, 'validate');
    }

    const check = validateNarrationDraft(draft, plan.formatType, plan.axisType, plan.periodType);
    if (check.ok) break;
    feedback = check.message;
    if (attempt === MAX_ATTEMPTS - 1) {
      throw new Error(`대본 검증 실패: ${check.message}`);
    }
  }

  if (progress) {
    await reportNarrationProgress(progress.historyId, progress.workspace, 'cta_append');
  }

  const bodyWithCta = appendNarrationScriptFooter(draft!.body, {
    workspace: plan.workspace,
    productTitle: plan.topic.label,
    axisType: plan.axisType,
  });
  const title =
    draft!.title ||
    buildFallbackNarrationTitle(plan.topic.label, plan.axisType, plan.formatType, plan.periodType);

  return { title, scriptBody: bodyWithCta, model };
}
