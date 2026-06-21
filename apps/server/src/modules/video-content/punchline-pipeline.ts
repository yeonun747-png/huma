import type { Workspace } from '@huma/shared';
import { askClaudeWithModel } from '../../lib/anthropic-client.js';
import { getMainClaudeModel, getSubClaudeModel } from '../../lib/ai-engine.js';
import {
  generateContiFromPunchline,
  type ContiGenerationResult,
} from './conti-generator.js';
import type { PreGenerationPlan } from './pre-generation-plan.js';

function parseJsonBlock(raw: string): unknown {
  const trimmed = raw.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fence ? fence[1]!.trim() : trimmed;
  return JSON.parse(body);
}

async function callClaudeJson(params: {
  model: string;
  max_tokens: number;
  prompt: string;
}): Promise<Record<string, unknown>> {
  const raw = await askClaudeWithModel(params);
  if (!raw) throw new Error('LLM 응답 없음');
  return parseJsonBlock(raw) as Record<string, unknown>;
}

function buildStage1Prompt(params: {
  workspace: Workspace;
  plan: PreGenerationPlan;
  pastSummaries: string[];
}): string {
  const { plan, pastSummaries, workspace } = params;
  const { conditions, personaText, yeonunProduct } = plan;

  const charBlock =
    workspace === 'panana' && conditions.characterDescription
      ? `\n파나나 캐릭터 "${conditions.characterName}" (고정 출연):\n${conditions.characterDescription}\n`
      : workspace === 'panana'
        ? ''
        : '\n등장인물은 매번 새로운 일반인으로 창작.\n';

  const pastBlock =
    pastSummaries.length ?
      `\n과거 시나리오 (겹치지 말 것):\n${pastSummaries.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n`
    : '';

  const situationLine = conditions.situationAxis ? `- 상황축: ${conditions.situationAxis}\n` : '';
  const productBlock = yeonunProduct ? `\n${yeonunProduct.contextText}\n(이번 영상에 자연스럽게 녹일 상품)\n` : '';

  return `한국어 숏폼 영상 — 펀치라인(결말) 아이디어 8개 발산.

영상 페르소나 (준수):
${personaText}

이번 영상 사전 조건 (고정):
- 관계축: ${conditions.relationshipAxis}
${situationLine}- 감정곡선: ${conditions.emotionCurve}
- 펀치라인 메커니즘(hook_type): ${conditions.hookType}
- hook_subtype (이번 발산 각도): ${conditions.hookSubtype}
- duration: ${conditions.duration}초
- cut_type: multi_shot
${charBlock}${productBlock}${pastBlock}

규칙:
- 정확히 8개. 각 1~2문장, 마지막 대사/상황이 펀치라인이 되도록.
- 8개 모두 hook_subtype "${conditions.hookSubtype}" 각도로 설계.
- 서로 다른 인물·장소·사건. 과거 시나리오와 겹치지 않게.
- 설명 없이 JSON만.

JSON:
{
  "ideas": ["아이디어1", "아이디어2", "아이디어3", "아이디어4", "아이디어5", "아이디어6", "아이디어7", "아이디어8"]
}`;
}

function buildStage2Prompt(ideas: string[]): string {
  const numbered = ideas.map((idea, i) => `${i + 1}. ${idea}`).join('\n');
  return `아래 8개 숏폼 펀치라인 아이디어 중 시청자가 "피식/헐" 할 가능성이 가장 높은 1개를 고른다.

${numbered}

기준: 반전 강도, 대사 임팩트, 클리셰 회피, 15초 내 전달 가능성.
JSON만 출력:
{ "index": 0, "reason": "한 줄 이유" }`;
}

export async function generatePunchlineIdeas(params: {
  workspace: Workspace;
  plan: PreGenerationPlan;
  pastSummaries: string[];
}): Promise<string[]> {
  const model = (await getMainClaudeModel()) || 'claude-sonnet-4-6';
  const parsed = await callClaudeJson({
    model,
    max_tokens: 2048,
    prompt: buildStage1Prompt(params),
  });

  const ideas = (parsed.ideas as string[] | undefined)?.map((s) => String(s).trim()).filter(Boolean) ?? [];
  if (ideas.length < 8) {
    throw new Error(`펀치라인 아이디어 8개 미만 (${ideas.length}개)`);
  }
  return ideas.slice(0, 8);
}

export async function selectPunchlineIdea(ideas: string[]): Promise<string> {
  const model = (await getSubClaudeModel()) || 'claude-haiku-4-5-20251001';
  const parsed = await callClaudeJson({
    model,
    max_tokens: 256,
    prompt: buildStage2Prompt(ideas),
  });

  const index = Number(parsed.index);
  if (!Number.isInteger(index) || index < 0 || index >= ideas.length) {
    return ideas[0]!;
  }
  return ideas[index]!;
}

export interface PunchlinePipelineResult {
  punchlineIdea: string;
  conti: ContiGenerationResult;
}

export async function runPunchlineContiPipeline(params: {
  workspace: Workspace;
  plan: PreGenerationPlan;
  pastSummaries: string[];
  /** 있으면 1~2단계 생략 (유머/유사도 재생성) */
  punchlineIdea?: string;
  feedback?: string;
  onStage?: (stage: string) => void | Promise<void>;
}): Promise<PunchlinePipelineResult> {
  let punchlineIdea = params.punchlineIdea?.trim() ?? '';

  if (!punchlineIdea) {
    await params.onStage?.('1단계 펀치라인 아이디어 8개 발산');
    const ideas = await generatePunchlineIdeas({
      workspace: params.workspace,
      plan: params.plan,
      pastSummaries: params.pastSummaries,
    });

    await params.onStage?.('2단계 Haiku 펀치라인 1개 선택');
    punchlineIdea = await selectPunchlineIdea(ideas);
  }

  await params.onStage?.('3단계 펀치라인 고정 콘티 생성');
  const conti = await generateContiFromPunchline({
    workspace: params.workspace,
    plan: params.plan,
    punchlineIdea,
    pastSummaries: params.pastSummaries,
    feedback: params.feedback,
    onStage: params.onStage,
  });

  return { punchlineIdea, conti };
}
