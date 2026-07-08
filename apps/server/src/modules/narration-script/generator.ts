import { askClaudeWithModel } from '../../lib/anthropic-client.js';
import { getMainClaudeModel } from '../../lib/ai-engine.js';
import { parseLlmJsonBlock } from '../../lib/llm-json.js';
import type { NarrationPickPlan } from './pick-plan.js';
import { resolveNarrationFormatForPeriod, resolveNarrationRankedTopN, resolveNarrationTopN } from '@huma/shared';
import { appendNarrationScriptFooter } from './cta-templates.js';
import { insertNarrationEngagementIntro } from './engagement-intro.js';
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
import { buildNarrationPersonaSystem } from './narration-persona.js';
import { loadNarrationPersonaText } from './narration-persona-store.js';
import { assertNarrationScriptNotCancelled } from './cancel.js';
import { resolveMonthlySeriesEpisode } from './monthly-series.js';

const MAX_ATTEMPTS = 2;
const LLM_PROGRESS_HEARTBEAT_MS = 2_500;

export interface NarrationGenerateProgressCtx {
  historyId: string;
  workspace: NarrationScriptWorkspace;
}

function workspaceLabel(ws: NarrationPickPlan['workspace']): string {
  return NARRATION_WORKSPACE_LABEL[ws];
}

async function callNarrationLlm(
  prompt: string,
  system: string,
  feedback?: string,
): Promise<GeneratedNarrationDraft> {
  const model = await getMainClaudeModel();
  const userPrompt = feedback ? `${prompt}\n\n[재작성] ${feedback}` : prompt;
  const raw = await askClaudeWithModel({
    model,
    max_tokens: 2048,
    system,
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
  system: string,
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
    return await callNarrationLlm(prompt, system, feedback);
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
  const formatType = resolveNarrationFormatForPeriod(plan.periodType, plan.formatType);
  const seriesEpisode = plan.seriesEpisode;
  const promptParams = {
    topicLabel: plan.topic.label,
    topicHookLabel: plan.topic.hookLabel,
    topicContext: plan.topic.contextText,
    axisType: plan.axisType,
    workspaceLabel: workspaceLabel(plan.workspace),
    periodType: plan.periodType,
    formatType,
    dateContext: plan.dateContext,
    seriesEpisode,
  };
  const basePrompt =
    formatType === 'full_cover'
      ? buildFullCoverPrompt(promptParams)
      : buildRankedPrompt(promptParams);

  const customPersona = await loadNarrationPersonaText(plan.workspace);
  const personaSystem = buildNarrationPersonaSystem(
    {
      workspace: plan.workspace,
      workspaceLabel: workspaceLabel(plan.workspace),
      topicLabel: plan.topic.label,
      topicHookLabel: plan.topic.hookLabel,
      axisType: plan.axisType,
      formatType,
      periodType: plan.periodType,
      dateContext: plan.dateContext,
    },
    customPersona,
  );

  const rankedTopN = resolveNarrationRankedTopN(plan.periodType, plan.axisType);
  const formatLabel =
    plan.periodType === 'monthly'
      ? `이달 TOP${resolveNarrationTopN(plan.axisType)} 시리즈${seriesEpisode ? ` ${seriesEpisode}편` : ''}`
      : `${formatType === 'ranked' ? '순위특집' : '전체커버'}·${plan.periodType}`;

  let feedback: string | undefined;
  let draft: GeneratedNarrationDraft | null = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (progress) {
      await assertNarrationScriptNotCancelled(progress.historyId);
    }

    draft = progress
      ? await callNarrationLlmWithProgress(basePrompt, personaSystem, feedback, progress, attempt, formatLabel)
      : await callNarrationLlm(basePrompt, personaSystem, feedback);

    if (progress) {
      await reportNarrationProgress(progress.historyId, progress.workspace, 'validate');
    }

    const check = validateNarrationDraft(
      draft,
      formatType,
      plan.axisType,
      plan.periodType,
      plan.topic.hookLabel,
      plan.topic.label,
    );
    if (check.ok) break;
    feedback = check.message;
    if (attempt === MAX_ATTEMPTS - 1) {
      throw new Error(`대본 검증 실패: ${check.message}`);
    }
  }

  if (progress) {
    await reportNarrationProgress(progress.historyId, progress.workspace, 'intro_append');
  }

  const bodyWithIntro = insertNarrationEngagementIntro(draft!.body, {
    axisType: plan.axisType,
    formatType: plan.formatType,
    topicLabel: plan.topic.label,
    workspace: plan.workspace,
    rankedTopN,
  });

  if (progress) {
    await reportNarrationProgress(progress.historyId, progress.workspace, 'cta_append');
  }

  const bodyWithCta = appendNarrationScriptFooter(bodyWithIntro, {
    workspace: plan.workspace,
    hookLabel: plan.topic.hookLabel,
    axisType: plan.axisType,
  });
  const title =
    draft!.title ||
    buildFallbackNarrationTitle(
      plan.topic.hookLabel,
      plan.axisType,
      formatType,
      plan.periodType,
      seriesEpisode,
    );

  return { title, scriptBody: bodyWithCta, model };
}
