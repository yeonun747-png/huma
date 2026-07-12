import type { Workspace } from '@huma/shared';
import type { VideoConti } from './types.js';
import { askClaudeWithModel } from '../../lib/anthropic-client.js';
import { callClaudeJsonWithRetry } from '../../lib/llm-json.js';
import { getSubClaudeModel } from '../../lib/ai-engine.js';
import {
  generateContiFromPunchline,
  CONTI_JSON_MAX_ATTEMPTS,
  CONTI_LLM_TIMEOUT_MS,
  type ContiGenerationResult,
  type Stage3RegenMode,
} from './conti-generator.js';
import { contiToStoryDraft, type StoryDraft } from './story-draft.js';
import {
  filterFilmableMustIncludeProps,
  type CoreMaterialPlacement,
} from './punchline-material.js';
import type { PreGenerationPlan } from './pre-generation-plan.js';
import { buildHookTypePromptBlock } from './persona-axis.js';
import { buildVideoCharacterAppearancePromptBlock } from './character-appearance.js';
import { buildQuizOasisBrandSafetyBlock } from './quiz-brand-safety.js';

async function callClaudeJson(params: {
  model: string;
  max_tokens: number;
  prompt: string;
}): Promise<Record<string, unknown>> {
  const { parsed } = await callClaudeJsonWithRetry<Record<string, unknown>>({
    ...params,
    maxAttempts: CONTI_JSON_MAX_ATTEMPTS,
    ask: (p) => askClaudeWithModel({ ...p, timeout_ms: CONTI_LLM_TIMEOUT_MS }),
  });
  return parsed;
}

async function getPunchlineHaikuModel(): Promise<string> {
  return (await getSubClaudeModel()) || 'claude-haiku-4-5-20251001';
}

export interface PunchlineSelection {
  punchlineIdea: string;
  mustIncludeProps: string[];
}

function buildStage1Prompt(params: {
  workspace: Workspace;
  plan: PreGenerationPlan;
  pastSummaries: string[];
}): string {
  const { plan, pastSummaries, workspace } = params;
  const { conditions, personaText, yeonunProduct, quizContent } = plan;

  const charBlock =
    workspace === 'panana' && conditions.characterDescription
      ? `\n파나나 캐릭터 "${conditions.characterName}" (고정 출연):\n${conditions.characterDescription}\n${buildVideoCharacterAppearancePromptBlock({ coStarAttractive: true })}`
      : workspace === 'panana'
        ? buildVideoCharacterAppearancePromptBlock()
        : buildVideoCharacterAppearancePromptBlock({ banServiceCharacters: true });

  const pastBlock =
    pastSummaries.length ?
      `\n과거 시나리오 (겹치지 말 것):\n${pastSummaries.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n`
    : '';

  const situationLine = conditions.situationAxis ? `- 상황축: ${conditions.situationAxis}\n` : '';
  const productBlock = yeonunProduct ? `\n${yeonunProduct.contextText}\n(이번 영상에 자연스럽게 녹일 상품)\n` : '';
  const quizBlock = quizContent ? `\n${quizContent.contextText}\n(이번 영상에 자연스럽게 녹일 테스트)\n` : '';
  const brandSafetyBlock = buildQuizOasisBrandSafetyBlock(workspace);
  const hookTypeBlock = buildHookTypePromptBlock(personaText, conditions.hookType);

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
${hookTypeBlock}${brandSafetyBlock}${charBlock}${productBlock}${quizBlock}${pastBlock}

규칙:
- 정확히 8개. 각 1~2문장, 마지막 대사/상황이 펀치라인이 되도록.
- 8개 모두 hook_type "${conditions.hookType}" 메커니즘으로 설계. 다른 메커니즘(반전·정곡찌르기 등)처럼 보이는 아이디어 금지.
- 8개 모두 hook_subtype "${conditions.hookSubtype}" 각도로 설계.
- 펀치라인에 촬영 가능한 구체적 소재(소지품·증거 사물)를 1~2개 포함하면 좋다. (앱 화면 글자·문서 내용은 소재로 쓰지 말 것)
- 서로 다른 인물·장소·사건. 과거 시나리오와 겹치지 않게.
- 설명 없이 JSON만.

JSON:
{
  "ideas": ["아이디어1", "아이디어2", "아이디어3", "아이디어4", "아이디어5", "아이디어6", "아이디어7", "아이디어8"]
}`;
}

function buildStage2Prompt(ideas: string[], hookType: string, workspace: Workspace): string {
  const numbered = ideas.map((idea, i) => `${i + 1}. ${idea}`).join('\n');
  const brandSafetyBlock = buildQuizOasisBrandSafetyBlock(workspace);
  return `아래 8개 숏폼 펀치라인 아이디어 중 시청자가 "피식/헐" 할 가능성이 가장 높은 1개를 고른다.

고정 hook_type: ${hookType}
${brandSafetyBlock}
${numbered}

기준 (우선순):
1. hook_type "${hookType}" 메커니즘 부합 (필수 — 부합하지 않으면 선택 금지)
2. 브랜드 필수 위반(테스트 결과=틀렸다/허세 폭로) 아이디어는 선택 금지
3. 반전 강도, 대사 임팩트, 클리셰 회피, 15초 내 전달 가능성

부합하는 아이디어가 여러 개면 3번 기준으로 최고를 고른다.

must_include_props 규칙:
- 선택한 아이디어의 펀치라인을 성립시키는 **필수** 촬영 가능 소품·사물 **1~2개만** (최대 2개)
- 스마트폰·반지 케이스·서류봉투·우산 등 OK
- "사주 결과 페이지", "앱 화면 글자", "이름이 적힌 …" 등 읽어야 하는 화면/문서는 제외
- dialogue로 전달할 정보는 props에 넣지 말 것

JSON만 출력:
{
  "index": 0,
  "reason": "한 줄 이유",
  "must_include_props": ["반지 케이스", "스마트폰"]
}`;
}

function parseMustIncludeProps(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return filterFilmableMustIncludeProps(raw.map((v) => String(v))).slice(0, 2);
}

export async function generatePunchlineIdeas(params: {
  workspace: Workspace;
  plan: PreGenerationPlan;
  pastSummaries: string[];
}): Promise<string[]> {
  const model = await getPunchlineHaikuModel();
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

export async function selectPunchlineIdea(
  ideas: string[],
  hookType: string,
  workspace: Workspace = 'yeonun',
): Promise<PunchlineSelection> {
  const model = await getPunchlineHaikuModel();
  const parsed = await callClaudeJson({
    model,
    max_tokens: 384,
    prompt: buildStage2Prompt(ideas, hookType, workspace),
  });

  const index = Number(parsed.index);
  const idea =
    Number.isInteger(index) && index >= 0 && index < ideas.length ? ideas[index]! : ideas[0]!;
  const mustIncludeProps = parseMustIncludeProps(parsed.must_include_props);

  return { punchlineIdea: idea, mustIncludeProps };
}

export async function inferMustIncludePropsFromIdea(punchlineIdea: string): Promise<string[]> {
  const model = (await getSubClaudeModel()) || 'claude-haiku-4-5-20251001';
  const parsed = await callClaudeJson({
    model,
    max_tokens: 256,
    prompt: `아래 펀치라인 아이디어를 13초 영상으로 만들 때 펀치라인에 **필수**인 촬영 가능 소품·사물 **1~2개만** JSON으로 추출하라.
읽어야 하는 앱 화면·문서 글자·이름 표시는 제외.

펀치라인:
${punchlineIdea}

JSON:
{ "must_include_props": ["...", "..."] }`,
  });
  return parseMustIncludeProps(parsed.must_include_props);
}

export interface PunchlinePipelineResult {
  punchlineIdea: string;
  mustIncludeProps: string[];
  conti: ContiGenerationResult;
}

export type { Stage3RegenMode } from './conti-generator.js';

/** punchlineIdea 고정 — 1~2단계 스킵, 3단계(3a/3b)만 재생성 */
export async function runPunchlineContiStage3Only(params: {
  workspace: Workspace;
  plan: PreGenerationPlan;
  punchlineIdea: string;
  mustIncludeProps?: string[];
  existingConti?: VideoConti;
  regenMode?: Stage3RegenMode;
  pastSummaries?: string[];
  feedback?: string;
  /** 최초 생성(1~2단계 직후) — 로그 라벨 구분 */
  isInitial?: boolean;
  onStage?: (stage: string) => void | Promise<void>;
}): Promise<PunchlinePipelineResult> {
  const punchlineIdea = params.punchlineIdea.trim();
  if (!punchlineIdea) {
    throw new Error('3단계만 재생성 — punchlineIdea가 필요합니다 (1~2단계 유지)');
  }

  let mustIncludeProps = params.mustIncludeProps ?? [];
  if (!mustIncludeProps.length) {
    await params.onStage?.('must_include_props 추론');
    mustIncludeProps = await inferMustIncludePropsFromIdea(punchlineIdea);
  }

  const regenMode = params.regenMode ?? 'full';
  if (params.isInitial) {
    await params.onStage?.('3단계 펀치라인 고정 콘티 생성 (3a→3b)');
  } else {
    await params.onStage?.(
      regenMode === 'format_only'
        ? '3b만 재생성 (3a·1~2단계 유지)'
        : regenMode === 'story_clarity'
          ? '3a 부분 수정 + 3b 재생성 (1~2단계 유지)'
          : '3단계 재생성 (1~2단계 유지)',
    );
  }

  const existingStoryDraft =
    (regenMode === 'format_only' || regenMode === 'story_clarity') && params.existingConti
      ? contiToStoryDraft(params.existingConti as VideoConti & { storyDraft?: StoryDraft })
      : undefined;

  const conti = await generateContiFromPunchline({
    workspace: params.workspace,
    plan: params.plan,
    punchlineIdea,
    mustIncludeProps,
    pastSummaries: params.pastSummaries,
    feedback: params.feedback,
    existingStoryDraft,
    regenMode,
    onStage: params.onStage,
  });

  return { punchlineIdea, mustIncludeProps, conti };
}

export async function runPunchlineContiPipeline(params: {
  workspace: Workspace;
  plan: PreGenerationPlan;
  pastSummaries: string[];
  punchlineIdea?: string;
  mustIncludeProps?: string[];
  feedback?: string;
  onStage?: (stage: string) => void | Promise<void>;
}): Promise<PunchlinePipelineResult> {
  let punchlineIdea = params.punchlineIdea?.trim() ?? '';
  let mustIncludeProps = params.mustIncludeProps ?? [];
  const isInitial = !params.punchlineIdea?.trim();

  if (!punchlineIdea) {
    await params.onStage?.('1단계 펀치라인 아이디어 8개 발산');
    const ideas = await generatePunchlineIdeas({
      workspace: params.workspace,
      plan: params.plan,
      pastSummaries: params.pastSummaries,
    });

    await params.onStage?.('2단계 Haiku 펀치라인 1개 선택 + must_include_props');
    const selected = await selectPunchlineIdea(
      ideas,
      params.plan.conditions.hookType,
      params.workspace,
    );
    punchlineIdea = selected.punchlineIdea;
    mustIncludeProps = selected.mustIncludeProps;
  } else if (!mustIncludeProps.length) {
    await params.onStage?.('must_include_props 추론');
    mustIncludeProps = await inferMustIncludePropsFromIdea(punchlineIdea);
  }

  return runPunchlineContiStage3Only({
    workspace: params.workspace,
    plan: params.plan,
    punchlineIdea,
    mustIncludeProps,
    pastSummaries: params.pastSummaries,
    feedback: params.feedback,
    isInitial,
    onStage: params.onStage,
  });
}
