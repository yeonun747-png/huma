import { askClaudeWithModel } from '../../lib/anthropic-client.js';
import { getMainClaudeModel } from '../../lib/ai-engine.js';
import { parseLlmJsonBlock } from '../../lib/llm-json.js';
import type { NarrationPickPlan } from './pick-plan.js';
import { appendNarrationCta } from './cta-templates.js';
import {
  buildFullCoverPrompt,
  buildRankedPrompt,
  validateNarrationDraft,
  type GeneratedNarrationDraft,
} from './validation.js';
import { NARRATION_WORKSPACE_LABEL, type NarrationScriptWorkspace } from '@huma/shared';
import { reportNarrationProgress } from './progress.js';
import { assertNarrationScriptNotCancelled } from './cancel.js';

const MAX_ATTEMPTS = 2;

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
    timeout_ms: 90_000,
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
  return { title, body };
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
        })
      : buildRankedPrompt({
          topicLabel: plan.topic.label,
          topicContext: plan.topic.contextText,
          axisType: plan.axisType,
          workspaceLabel: workspaceLabel(plan.workspace),
        });

  let feedback: string | undefined;
  let draft: GeneratedNarrationDraft | null = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (progress) {
      await assertNarrationScriptNotCancelled(progress.historyId);
      await reportNarrationProgress(
        progress.historyId,
        progress.workspace,
        attempt === 0 ? 'llm_write' : 'llm_retry',
        attempt === 0
          ? `Sonnet 대본 작성 중… (${plan.formatType === 'ranked' ? '순위특집' : '전체커버'})`
          : `대본 재작성 중… (${attempt + 1}/${MAX_ATTEMPTS}회)`,
      );
    }

    draft = await callNarrationLlm(basePrompt, feedback);

    if (progress) {
      await reportNarrationProgress(progress.historyId, progress.workspace, 'validate');
    }

    const check = validateNarrationDraft(draft, plan.formatType, plan.axisType);
    if (check.ok) break;
    feedback = check.message;
    if (attempt === MAX_ATTEMPTS - 1) {
      throw new Error(`대본 검증 실패: ${check.message}`);
    }
  }

  if (progress) {
    await reportNarrationProgress(progress.historyId, progress.workspace, 'cta_append');
  }

  const bodyWithCta = appendNarrationCta(draft!.body, plan.workspace, plan.topic.label);
  const title =
    draft!.title ||
    (plan.formatType === 'ranked'
      ? `${plan.topic.label} TOP5`
      : `${plan.topic.label} — ${plan.axisType === 'zodiac' ? '띠별' : plan.axisType === 'constellation' ? '별자리별' : '연령대별'} 풀이`);

  return { title, scriptBody: bodyWithCta, model };
}
