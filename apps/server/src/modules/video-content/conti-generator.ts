import type { Workspace } from '@huma/shared';
import { askClaudeWithModel } from '../../lib/anthropic-client.js';
import { callClaudeJsonWithRetry } from '../../lib/llm-json.js';
import { getMainClaudeModel, getSubClaudeModel } from '../../lib/ai-engine.js';
import {
  enforcePunchlineShotMinDuration,
  finalizeContiTimeline,
  validateCutTypeMatchesRawShots,
  validatePunchlineShotMinDuration,
  enforceAllShotsMinDuration,
  validateAllShotsMinDuration,
  findIncompleteLastShotIndex,
  validateCharacterNameConsistency,
  extractCharacterNamesForStorage,
  buildMultiShotCompositionGuide,
  buildShotContentRule,
  buildScreenTextRenderingRule,
  buildYeonunFortuneDialogueRule,
  buildDialogueLengthRule,
  buildDialogueDistinctRule,
  buildPunchlineClarityRule,
  buildSingleShotFoundationCutRule,
  buildMultiShotFoundationCutRule,
  buildSingleShotGuide,
  buildCharacterNamingRule,
  buildCameraActionNoRepeatRule,
  buildSentenceCompleteRule,
  buildShotCountPreferLowerGuide,
  ContiValidationError,
  CONTI_FOUNDATION_MAX_TOKENS,
  CONTI_SHOTS_MAX_TOKENS,
  CONTI_SINGLE_SHOTS_MAX_TOKENS,
  PUNCHLINE_MIN_DURATION_SEC,
  SHOT_CONTENT_MIN_CHARS,
} from './conti-validation.js';
import { enforceDialogueOnConti } from './dialogue-timing.js';
import {
  applyGenericActionNarrativeFallback,
  findGenericActionShotNumbers,
  GENERIC_ACTION_NARRATIVE_FALLBACK_WARNING,
} from './generic-action-fallback.js';
import { applyRuleBasedShotRecovery } from './conti-recovery.js';
import { findRealNamesInShots, buildCharacterNameToLabelMap } from './character-labels.js';
import {
  buildMetadataTagInstruction,
  metadataTagsFromConditions,
  parseContiMetadataTags,
  validateContiMetadataTags,
  type ContiMetadataTags,
} from './conti-metadata.js';
import { extractSectionBody, buildHookTypePromptBlock } from './persona-axis.js';
import { normalizeMultiShotConti, normalizeSingleShotConti, buildEvoLinkPrompt } from './evolink.js';
import { EVOLINK_PROMPT_LENGTH_GUIDANCE } from './prompt-length.js';
import { getShotCountBounds } from './shot-timing.js';
import type { GenerationConditions, VideoConti, VideoContiShot, VideoPersonaConfig } from './types.js';
import { asContiCharacters, asContiShots, DEFAULT_VIDEO_PERSONAS } from './types.js';
import type { PreGenerationPlan } from './pre-generation-plan.js';
import {
  buildCoreMaterialShotsInstruction,
  parseCoreMaterialTagsFromResponse,
  validateCoreMaterials,
} from './punchline-material.js';
import {
  assessStoryDraftComprehension,
  MAX_STORY_COMPREHENSION_REGEN,
  regenerateStoryDraftForClarity,
  STORY_COMPREHENSION_REGEN_FEEDBACK,
  STORY_COMPREHENSION_LIMIT_WARNING,
} from './story-comprehension.js';
import {
  buildFormatConversionIntro,
  buildStoryDraftPrompt,
  MAX_STORY_REGEN_ON_FORMAT_FAIL,
  parseStoryDraft,
  STORY_DRAFT_MAX_TOKENS,
  storyDraftToFoundation,
  type ContiFoundation,
  type StoryDraft,
} from './story-draft.js';

export type { ContiFoundation, StoryDraft };

/** P1 — 3a Sonnet / 3b·패치 Haiku LLM 타임아웃 */
export const CONTI_LLM_TIMEOUT_MS = 45_000;
export const CONTI_JSON_MAX_ATTEMPTS = 3;

export interface ContiGenerationResult extends VideoConti {
  locationKeyword: string;
  timeOfDay: string;
  /** 샷 품질 보완 경고 — 운영자 검토용 */
  contentWarnings?: string[];
  /** 마지막 샷 문장 미완결 — max_tokens 부족 신호 */
  lastShotIncompleteDetected?: boolean;
  /** A/B 라벨 제외 실제 부여 이름 — history.character_names 저장용 */
  characterNames?: string[];
  /** 3a단계 자유 서술 — 3b-only 재생성·검토용 */
  storyDraft?: StoryDraft;
}

interface PromptContext {
  workspace: Workspace;
  config: VideoPersonaConfig;
  conditions: GenerationConditions;
  feedback?: string;
  pastSummaries?: string[];
  onStage?: (stage: string) => void | Promise<void>;
  /** v3.59 — 펀치라인 고정 콘티 */
  personaText?: string;
  punchlineIdea?: string;
  yeonunProductContext?: string;
  quizContentContext?: string;
  expectedMetadata?: ContiMetadataTags;
  mustIncludeProps?: string[];
  storyDraft?: StoryDraft;
}

async function reportStage(ctx: PromptContext, stage: string): Promise<void> {
  await ctx.onStage?.(stage);
}

async function getContiSonnetModel(): Promise<string> {
  return (await getMainClaudeModel()) || 'claude-sonnet-4-6';
}

async function getContiHaikuModel(): Promise<string> {
  return (await getSubClaudeModel()) || 'claude-haiku-4-5-20251001';
}

async function callClaudeJson(params: {
  model: string;
  max_tokens: number;
  prompt: string;
  maxAttempts?: number;
}): Promise<{ parsed: Record<string, unknown>; raw: string }> {
  return callClaudeJsonWithRetry<Record<string, unknown>>({
    ...params,
    maxAttempts: params.maxAttempts ?? CONTI_JSON_MAX_ATTEMPTS,
    ask: (p) => askClaudeWithModel({ ...p, timeout_ms: CONTI_LLM_TIMEOUT_MS }),
  });
}

function buildMultiShotGuide(ctx: PromptContext): string {
  const { conditions, config } = ctx;
  const punchlineDurationRule = `펀치라인이 들어가는 샷(고정 번호 없음 — 시나리오 중후반 적절한 샷)은 대사를 끝까지 전달할 수 있도록 최소 ${PUNCHLINE_MIN_DURATION_SEC}초를 확보하라.`;

  let personaGuide: string | undefined;
  if (ctx.personaText) {
    personaGuide = extractSectionBody(ctx.personaText, '샷 구조') || undefined;
  } else {
    personaGuide = config.shotStructure?.trim();
  }
  const baseGuide = personaGuide ?? buildMultiShotCompositionGuide(conditions.duration);
  const yeonunFortuneBlock =
    ctx.workspace === 'yeonun' ? `\n${buildYeonunFortuneDialogueRule()}\n` : '';

  return `${baseGuide}
${buildShotCountPreferLowerGuide(conditions.duration)}
${buildShotContentRule()}${yeonunFortuneBlock}
${punchlineDurationRule}
shots 배열 길이는 ${getShotCountBounds(conditions.duration).min}~${getShotCountBounds(conditions.duration).max}개 — **가능하면 ${getShotCountBounds(conditions.duration).min}개(하한) 우선**. startSec/endSec 합 = ${conditions.duration}. 각 action ${SHOT_CONTENT_MIN_CHARS}자 이상, narrativeProse 사건을 action에 반영.
${EVOLINK_PROMPT_LENGTH_GUIDANCE}`;
}

function buildSharedContext(ctx: PromptContext): {
  charBlock: string;
  pastBlock: string;
  feedbackBlock: string;
  cutRuleBlock: string;
  situationLine: string;
  storyAxis: string;
} {
  const { conditions, config, feedback, pastSummaries, workspace } = ctx;
  const charBlock =
    workspace === 'panana' && conditions.characterDescription
      ? `\n파나나 캐릭터 "${conditions.characterName}" 외형/톤/말버릇 (고정):\n${conditions.characterDescription}\n`
      : workspace === 'panana'
        ? ''
        : '\n등장인물은 매번 새로운 일반인으로 창작. 서비스 캐릭터 비등장.\n';

  const pastBlock =
    pastSummaries?.length ?
      `\n과거 시나리오 (겹치지 말 것):\n${pastSummaries.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n`
    : '';

  const feedbackBlock = feedback ? `\n⚠️ 재작성/보완 요청: ${feedback}\n` : '';

  const cutRuleBlock =
    conditions.cutType === 'single_shot'
      ? `\n${buildSingleShotFoundationCutRule()}\n`
      : ctx.personaText
        ? (() => {
            const cutRule = extractSectionBody(ctx.personaText!, '컷 구성');
            return cutRule ? `\n${buildMultiShotFoundationCutRule(cutRule)}\n` : `\n${buildMultiShotFoundationCutRule()}\n`;
          })()
        : config.cutTypeRule?.trim()
          ? `\n${buildMultiShotFoundationCutRule(config.cutTypeRule.trim())}\n`
          : `\n${buildMultiShotFoundationCutRule()}\n`;

  const situationLine = conditions.situationAxis ? `- 상황축: ${conditions.situationAxis}\n` : '';
  const storyAxis =
    conditions.situationAxis != null
      ? `[${conditions.relationshipAxis}] 관계 · [${conditions.situationAxis}] 상황`
      : `[${conditions.relationshipAxis}] 관계`;

  return { charBlock, pastBlock, feedbackBlock, cutRuleBlock, situationLine, storyAxis };
}

function buildFoundationPrompt(ctx: PromptContext): string {
  const { conditions, config } = ctx;
  const { charBlock, pastBlock, feedbackBlock, cutRuleBlock, situationLine, storyAxis } =
    buildSharedContext(ctx);

  const punchlineBlock = ctx.punchlineIdea
    ? `\n선택된 펀치라인(결말 고정 — 반드시 이 결말로 수렴, 변경 금지):\n${ctx.punchlineIdea}\n\n시나리오·등장인물·장소는 위 펀치라인을 뒤집어 설계하라.\n`
    : '';

  const productBlock = ctx.yeonunProductContext ? `\n${ctx.yeonunProductContext}\n` : '';
  const quizBlock = ctx.quizContentContext ? `\n${ctx.quizContentContext}\n` : '';
  const mustIncludeBlock = ctx.mustIncludeProps?.length
    ? `\n반드시 샷에 포함할 핵심 소재(must_include — 3단계에서 각각 최소 1샷): ${ctx.mustIncludeProps.join(', ')}\n`
    : '';

  if (ctx.personaText) {
    const hookSubtypeLine = conditions.cutType === 'multi_shot' && 'hookSubtype' in conditions
      ? `- hook_subtype: ${(conditions as GenerationConditions & { hookSubtype?: string }).hookSubtype ?? ''}\n`
      : '';
    const hookTypeBlock = buildHookTypePromptBlock(ctx.personaText, conditions.hookType);

    return `한국어 숏폼 영상 콘티 1단계 — 시나리오·등장인물·장소만 JSON으로 작성하라 (샷/shots 없음).

영상 페르소나 (생성 시 반드시 준수):
${ctx.personaText}

이번 영상 사전 조건 (코드에서 확정 — 2단계 메타 태그와 일치해야 함):
- 관계축: ${conditions.relationshipAxis}
${situationLine}- 감정곡선: ${conditions.emotionCurve}
- 펀치라인 메커니즘(hook_type): ${conditions.hookType}
${hookSubtypeLine}- cut_type: multi_shot
- duration: ${conditions.duration}초
${hookTypeBlock}${punchlineBlock}${productBlock}${quizBlock}${mustIncludeBlock}${charBlock}${cutRuleBlock}${pastBlock}${feedbackBlock}

창작 지침:
"이번 영상은 ${storyAxis}의 인물들이 등장하고, 새로 창작한 장소/시간에서 벌어지는 [${conditions.emotionCurve}] 흐름의 이야기.
등장인물 이름·외형·구체적 상황은 전부 새로 창작. 과거 시나리오와 겹치지 않게.
[${conditions.hookType}] 메커니즘의 펀치라인이 터지도록 이야기를 설계.
location_keyword와 time_of_day도 새로 창작."

등장인물 이름 규칙:
${buildCharacterNamingRule()}

JSON 스키마:
{
  "locationKeyword": "string",
  "timeOfDay": "string",
  "characters": [{"label":"A","name":"하은","age":"20대","gender":"여","hair":"...","outfit":"...","shoes":"..."},{"label":"B","name":"준형","age":"30대","gender":"남","hair":"...","outfit":"...","shoes":"..."}],
  "location": "구체적 장소 묘사",
  "lighting": "조명",
  "timeOfDayVisual": "시각적 시간대",
  "scenarioSummary": "2~3문장 요약",
  "fullText": "등장인물 설정+시나리오 개요(샷 대사는 2단계에서 추가)"
}`;
  }

  return `한국어 숏폼 영상 콘티 1단계 — 시나리오·등장인물·장소만 JSON으로 작성하라 (샷/shots 없음).

이번 영상 조건:
- 관계축: ${conditions.relationshipAxis}
${situationLine}- 감정곡선: ${conditions.emotionCurve}
- 펀치라인 메커니즘: ${conditions.hookType}
- cut_type: ${conditions.cutType}
- duration: ${conditions.duration}초
${charBlock}
${config.serviceConstraints}
${config.hookTypeGuidance?.trim() ? `\n펀치라인·연출 원칙 (선택 메커니즘과 별도 — action/dialogue에 반영, 단 카메라 직시 등 금지 규칙은 반드시 준수):\n${config.hookTypeGuidance.trim()}\n` : ''}${cutRuleBlock}${pastBlock}${feedbackBlock}

창작 지침:
"이번 영상은 ${storyAxis}의 인물들이 등장하고, 새로 창작한 장소/시간에서 벌어지는 [${conditions.emotionCurve}] 흐름의 이야기.
등장인물 이름·외형·구체적 상황은 전부 새로 창작. 과거 시나리오와 겹치지 않게.
[${conditions.hookType}] 방식의 펀치라인이 터지도록 이야기를 설계.
location_keyword와 time_of_day도 새로 창작."

등장인물 이름 규칙:
${buildCharacterNamingRule()}

JSON 스키마:
{
  "locationKeyword": "string",
  "timeOfDay": "string",
  "characters": [{"label":"A","name":"하은","age":"20대","gender":"여","hair":"...","outfit":"...","shoes":"..."},{"label":"B","name":"준형","age":"30대","gender":"남","hair":"...","outfit":"...","shoes":"..."}],
  "location": "구체적 장소 묘사",
  "lighting": "조명",
  "timeOfDayVisual": "시각적 시간대",
  "scenarioSummary": "2~3문장 요약",
  "fullText": "등장인물 설정+시나리오 개요(샷 대사는 2단계에서 추가)"
}`;
}

function buildShotGuide(ctx: PromptContext): string {
  const { conditions, config } = ctx;
  if (conditions.cutType === 'single_shot') {
    return `${buildSingleShotGuide(conditions.duration, config.singleShotStructure)}\n${EVOLINK_PROMPT_LENGTH_GUIDANCE}`;
  }
  return buildMultiShotGuide(ctx);
}

function buildShotsJsonSchema(conditions: GenerationConditions): string {
  if (conditions.cutType === 'single_shot') {
    return `{
  "shots": [{"shotNumber":1,"startSec":0,"endSec":${conditions.duration},"camera":"고정 미디엄","action":"...(시간 비트를 action 안에)","dialogue":"..."}],
  "fullText": "1단계 fullText + 전체 대사를 합친 최종 텍스트 (선택)"
}`;
  }
  return `{
  "shots": [{"shotNumber":1,"startSec":0,"endSec":3,"camera":"와이드","action":"...","dialogue":"..."}, "... ${getShotCountBounds(conditions.duration).min}~${getShotCountBounds(conditions.duration).max}개"],
  "fullText": "1단계 fullText + 전체 대사를 합친 최종 텍스트 (선택)"
}`;
}

function buildShotsPrompt(ctx: PromptContext, foundation: ContiFoundation): string {
  const { feedbackBlock } = buildSharedContext(ctx);
  const shotGuide = buildShotGuide(ctx);
  const cutTypeNote =
    ctx.conditions.cutType === 'single_shot'
      ? '\n⚠️ cut_type=single_shot — shots 배열은 반드시 1개만 출력.\n'
      : '';

  const metadataBlock = ctx.expectedMetadata
    ? `\n${buildMetadataTagInstruction(ctx.expectedMetadata)}\n`
    : '';

  const materialBlock = ctx.mustIncludeProps?.length
    ? `\n${buildCoreMaterialShotsInstruction(ctx.mustIncludeProps)}\n`
    : '';

  const storySource = ctx.storyDraft
    ? `${buildFormatConversionIntro(ctx.storyDraft)}

⚠️ 3b 최우선: 3a narrativeProse의 **모든 사건·발견·반응**을 샷 action에 구체적으로 반영한다.
"행동과 반응이 이어지며", "상황을 소개한다", "여운 있게 마무리" 등 빈 filler action 금지.
⚠️ 3b단계 — 위 3a 이야기를 그대로 유지하고 camera/action/dialogue JSON으로 **형식만** 분배한다.
펀치라인·사건 순서·대사 **의미**를 새로 바꾸거나 약화하지 말 것.`
    : `1단계 설정 (변경 금지):
${JSON.stringify(foundation, null, 2)}`;

  return `한국어 숏폼 영상 콘티 3b단계 — 확정 이야기를 샷별 camera/action/dialogue JSON으로 변환하라.
${cutTypeNote}action·dialogue 본문에는 A/B 라벨만 사용. 실명은 characters[].name에만 두고 action/dialogue에 쓰지 말 것.
${storySource}
${feedbackBlock}

샷 구성 규칙 (형식 — 내용 변경 없이 적용):
${shotGuide}

대사 분배:
${buildDialogueDistinctRule()}

JSON 스키마:
${buildShotsJsonSchema(ctx.conditions)}${materialBlock}${metadataBlock}`;
}

function parseFoundation(parsed: Record<string, unknown>): ContiFoundation {
  return {
    locationKeyword: String(parsed.locationKeyword ?? ''),
    timeOfDay: String(parsed.timeOfDay ?? ''),
    characters: asContiCharacters(parsed.characters),
    location: String(parsed.location ?? ''),
    lighting: String(parsed.lighting ?? ''),
    timeOfDayVisual: String(parsed.timeOfDayVisual ?? parsed.timeOfDay ?? ''),
    scenarioSummary: String(parsed.scenarioSummary ?? ''),
    fullText: String(parsed.fullText ?? parsed.scenarioSummary ?? ''),
  };
}

function assembleConti(
  foundation: ContiFoundation,
  shots: VideoContiShot[] | unknown,
  conditions: GenerationConditions,
  fullTextOverride?: string,
): VideoConti {
  const normalizedShots = asContiShots(shots);
  return {
    characters: asContiCharacters(foundation.characters),
    location: foundation.location,
    lighting: foundation.lighting,
    timeOfDay: foundation.timeOfDayVisual || foundation.timeOfDay,
    cutType: conditions.cutType,
    duration: conditions.duration,
    shots: normalizedShots,
    scenarioSummary: foundation.scenarioSummary,
    fullText: fullTextOverride?.trim() || foundation.fullText,
  };
}

function warnRemainingGenericActions(
  conti: VideoConti,
  ctx: PromptContext,
  foundation: ContiFoundation,
  warnings: string[],
): VideoConti {
  let current = conti;
  const remaining = findGenericActionShotNumbers(current);
  if (!remaining.length) return current;

  const fallback = applyGenericActionNarrativeFallback(current, {
    storyDraft: ctx.storyDraft,
    scenarioSummary: foundation.scenarioSummary,
  });
  if (fallback.replacedShotNumbers.length) {
    current = fallback.conti;
    warnings.push(
      `${GENERIC_ACTION_NARRATIVE_FALLBACK_WARNING} — 샷 ${fallback.replacedShotNumbers.join(', ')}`,
    );
  }

  const still = findGenericActionShotNumbers(current);
  if (still.length) {
    warnings.push(`filler action 잔존 (샷 ${still.join(', ')}) — EvoLink 전 검토 권장`);
  }
  return current;
}

async function generateStoryDraft(ctx: PromptContext, model: string): Promise<StoryDraft> {
  const { parsed } = await callClaudeJson({
    model,
    max_tokens: STORY_DRAFT_MAX_TOKENS,
    prompt: buildStoryDraftPrompt({
      workspace: ctx.workspace,
      conditions: ctx.conditions,
      personaText: ctx.personaText,
      serviceConstraintsFallback: ctx.config.serviceConstraints,
      punchlineIdea: ctx.punchlineIdea ?? '',
      mustIncludeProps: ctx.mustIncludeProps,
      yeonunProductContext: ctx.yeonunProductContext,
      quizContentContext: ctx.quizContentContext,
      pastSummaries: ctx.pastSummaries,
      charBlock: buildSharedContext(ctx).charBlock,
      feedback: ctx.feedback,
    }),
  });
  return parseStoryDraft(parsed);
}

async function ensureStoryDraftComprehension(
  ctx: PromptContext,
  storyDraft: StoryDraft,
  punchlineIdea: string,
  model: string,
): Promise<{ draft: StoryDraft; warnings: string[] }> {
  const warnings: string[] = [];
  let current = storyDraft;
  for (let attempt = 0; attempt <= MAX_STORY_COMPREHENSION_REGEN; attempt++) {
    await reportStage(
      ctx,
      attempt === 0 ? '3a 이해도 평가' : `3a 이해도 보완 (${attempt}/${MAX_STORY_COMPREHENSION_REGEN})`,
    );
    const verdict = await assessStoryDraftComprehension(current, punchlineIdea);
    if (verdict === 'clear') return { draft: current, warnings };
    if (attempt >= MAX_STORY_COMPREHENSION_REGEN) {
      warnings.push(STORY_COMPREHENSION_LIMIT_WARNING);
      await reportStage(ctx, STORY_COMPREHENSION_LIMIT_WARNING);
      return { draft: current, warnings };
    }
    const clarityFeedback = ctx.feedback
      ? `${STORY_COMPREHENSION_REGEN_FEEDBACK}\n${ctx.feedback}`
      : STORY_COMPREHENSION_REGEN_FEEDBACK;
    current = await regenerateStoryDraftForClarity({
      existing: current,
      punchlineIdea,
      feedback: clarityFeedback,
      model,
    });
  }
  return { draft: current, warnings };
}

/** @deprecated 3a story-draft 경로 사용 — legacy fallback */
async function generateFoundation(ctx: PromptContext, model: string): Promise<ContiFoundation> {
  const { parsed } = await callClaudeJson({
    model,
    max_tokens: CONTI_FOUNDATION_MAX_TOKENS,
    prompt: buildFoundationPrompt(ctx),
  });
  return parseFoundation(parsed);
}

async function generateShots(
  ctx: PromptContext,
  foundation: ContiFoundation,
  model: string,
): Promise<{ shots: VideoContiShot[]; fullText?: string; raw?: string }> {
  const maxTokens =
    ctx.conditions.cutType === 'single_shot' ? CONTI_SINGLE_SHOTS_MAX_TOKENS : CONTI_SHOTS_MAX_TOKENS;
  const { parsed, raw } = await callClaudeJson({
    model,
    max_tokens: maxTokens,
    prompt: buildShotsPrompt(ctx, foundation),
  });
  const shots = asContiShots(parsed.shots);
  const fullText = parsed.fullText ? String(parsed.fullText) : undefined;
  return { shots, fullText, raw };
}

function recoverRawShotContent(
  ctx: PromptContext,
  foundation: ContiFoundation,
  conti: VideoConti,
): { conti: VideoConti; warnings: string[] } {
  return applyRuleBasedShotRecovery({
    conti,
    storyDraft: ctx.storyDraft,
    scenarioSummary: foundation.scenarioSummary,
  });
}

function applyCutTypeNormalization(
  conti: VideoConti,
  conditions: GenerationConditions,
): { conti: VideoConti; warnings: string[] } {
  if (conditions.cutType === 'multi_shot') {
    return { conti: normalizeMultiShotConti(conti, conditions.duration), warnings: [] };
  }
  const { conti: normalized, merged } = normalizeSingleShotConti(conti, conditions.duration);
  return {
    conti: normalized,
    warnings: merged
      ? ['single_shot — LLM이 여러 샷을 반환해 1샷으로 자동 병합했습니다. 콘티 검토를 권장합니다.']
      : [],
  };
}

async function ensureCutTypeMatches(
  ctx: PromptContext,
  foundation: ContiFoundation,
  conti: VideoConti,
): Promise<{ conti: VideoConti; warnings: string[] }> {
  const warnings: string[] = [];
  let current = conti;

  const check = validateCutTypeMatchesRawShots(ctx.conditions.cutType, current.shots);
  if (check.ok) return { conti: current, warnings };

  if (ctx.conditions.cutType === 'single_shot') {
    const normalized = applyCutTypeNormalization(current, ctx.conditions);
    current = normalized.conti;
    warnings.push(...normalized.warnings);
    const afterNormalize = validateCutTypeMatchesRawShots(ctx.conditions.cutType, current.shots);
    if (afterNormalize.ok) return { conti: current, warnings };
    warnings.push(`single_shot cut 불일치 — 자동 병합 후에도 검증 실패: ${afterNormalize.feedback}`);
    return { conti: current, warnings };
  }

  throw new ContiValidationError(check.feedback);
}

export function contiToFoundation(conti: VideoConti & { locationKeyword?: string }): ContiFoundation {
  return {
    locationKeyword: String(conti.locationKeyword ?? ''),
    timeOfDay: String(conti.timeOfDay ?? ''),
    characters: conti.characters,
    location: conti.location,
    lighting: conti.lighting,
    timeOfDayVisual: conti.timeOfDay,
    scenarioSummary: conti.scenarioSummary,
    fullText: conti.fullText || conti.scenarioSummary,
  };
}

async function finalizeContiFromParts(
  params: PromptContext,
  foundation: ContiFoundation,
  shots: VideoContiShot[],
  fullText: string | undefined,
): Promise<ContiGenerationResult> {
  let conti = assembleConti(foundation, shots, params.conditions, fullText);
  const contentWarnings: string[] = [];
  let lastShotIncompleteDetected = findIncompleteLastShotIndex(conti) != null;

  await reportStage(params, '샷 품질 보완 (규칙)');
  const recovered = recoverRawShotContent(params, foundation, conti);
  conti = recovered.conti;
  contentWarnings.push(...recovered.warnings);

  if (params.conditions.cutType === 'multi_shot') {
    conti = normalizeMultiShotConti(conti, params.conditions.duration);
  } else {
    const normalized = applyCutTypeNormalization(conti, params.conditions);
    conti = normalized.conti;
    contentWarnings.push(...normalized.warnings);
  }

  await reportStage(params, 'cutType 정규화·검증');
  const cutEnsured = await ensureCutTypeMatches(params, foundation, conti);
  conti = cutEnsured.conti;
  contentWarnings.push(...cutEnsured.warnings);

  conti = enforcePunchlineShotMinDuration(conti);
  const durationFix = enforceAllShotsMinDuration(conti);
  conti = durationFix.conti;
  if (durationFix.adjusted) {
    contentWarnings.push('샷 최소 길이 미달 — 타임라인 자동 재분배 (검토 권장)');
  }
  conti = finalizeContiTimeline(conti, params.conditions.duration);

  const dialogueFix = enforceDialogueOnConti(conti);
  conti = dialogueFix.conti;
  if (dialogueFix.adjusted) {
    contentWarnings.push(...dialogueFix.warnings);
  }

  const punchCheck = validatePunchlineShotMinDuration(conti);
  if (!punchCheck.ok) {
    contentWarnings.push(`펀치라인 샷 길이 부족(통과): ${punchCheck.feedback}`);
  }

  const shotDurCheck = validateAllShotsMinDuration(conti);
  if (!shotDurCheck.ok) {
    contentWarnings.push(`샷 길이 검증 경고: ${shotDurCheck.feedback}`);
  }

  lastShotIncompleteDetected =
    lastShotIncompleteDetected || findIncompleteLastShotIndex(conti) != null;

  const extraAllowedNames = params.conditions.characterName ? [params.conditions.characterName] : [];
  const nameCheck = validateCharacterNameConsistency(conti, extraAllowedNames);
  if (!nameCheck.ok) {
    contentWarnings.push(
      `등장인물 이름 불일치 감지(콘티는 통과): ${nameCheck.unregisteredNames.join(', ')} — 검토 권장`,
    );
  }

  const nameToLabel = buildCharacterNameToLabelMap(conti);
  const leakedNames = findRealNamesInShots(conti, nameToLabel);
  if (leakedNames.length) {
    contentWarnings.push(
      `샷 본문 실명 사용(${leakedNames.join(', ')}) — EvoLink 프롬프트는 A/B로 자동 치환. 이후 생성은 action·dialogue에 A/B만 쓰도록 권장`,
    );
  }

  const characterNames = extractCharacterNamesForStorage(conti, params.conditions.characterName);
  conti = warnRemainingGenericActions(conti, params, foundation, contentWarnings);

  return {
    ...conti,
    locationKeyword: foundation.locationKeyword,
    timeOfDay: conti.timeOfDay,
    contentWarnings: contentWarnings.length ? contentWarnings : undefined,
    lastShotIncompleteDetected: lastShotIncompleteDetected || undefined,
    characterNames: characterNames.length ? characterNames : undefined,
  };
}

async function generateContiShotsFromFoundation(params: {
  ctx: PromptContext;
  foundation: ContiFoundation;
  haikuModel: string;
  initialFeedback?: string;
}): Promise<ContiGenerationResult> {
  const { ctx, foundation, haikuModel } = params;
  const mustIncludeProps = ctx.mustIncludeProps ?? [];
  const shotCtx = params.initialFeedback ? { ...ctx, feedback: params.initialFeedback } : ctx;
  const extraWarnings: string[] = [];

  await reportStage(ctx, '3b단계 형식 변환 (샷 분배)');
  const { shots, fullText, raw } = await generateShots(shotCtx, foundation, haikuModel);

  if (mustIncludeProps.length && raw) {
    const placements = parseCoreMaterialTagsFromResponse(raw);
    const materialCheck = validateCoreMaterials({
      mustIncludeProps,
      placements,
      shots,
    });
    if (!materialCheck.ok) {
      await reportStage(ctx, '핵심 소재 검증 경고 — 검토 단계로 진행');
      extraWarnings.push(`핵심 소재 검증: ${materialCheck.message}`);
    }
  }

  const parsedMeta = raw ? parseContiMetadataTags(raw) : null;
  if (ctx.expectedMetadata) {
    if (!parsedMeta) {
      extraWarnings.push('메타 태그 LLM 미출력 — DB 저장 조건값 사용');
    } else {
      const metaCheck = validateContiMetadataTags(parsedMeta, ctx.expectedMetadata);
      if (!metaCheck.ok) extraWarnings.push(`메타 태그: ${metaCheck.message}`);
    }
  }

  const conti = await finalizeContiFromParts(shotCtx, foundation, shots, fullText);
  if (!extraWarnings.length) return conti;
  return {
    ...conti,
    contentWarnings: [...(conti.contentWarnings ?? []), ...extraWarnings],
  };
}
function buildPunchlinePromptContext(params: {
  workspace: Workspace;
  plan: PreGenerationPlan;
  punchlineIdea: string;
  mustIncludeProps?: string[];
  pastSummaries?: string[];
  feedback?: string;
  onStage?: (stage: string) => void | Promise<void>;
}): PromptContext {
  const { plan, punchlineIdea } = params;
  return {
    workspace: params.workspace,
    config: DEFAULT_VIDEO_PERSONAS[params.workspace],
    conditions: plan.conditions,
    personaText: plan.personaText,
    punchlineIdea,
    mustIncludeProps: params.mustIncludeProps ?? [],
    yeonunProductContext: plan.yeonunProduct?.contextText,
    quizContentContext: plan.quizContent?.contextText,
    expectedMetadata: metadataTagsFromConditions(plan.conditions),
    feedback: params.feedback,
    pastSummaries: params.pastSummaries,
    onStage: params.onStage,
  };
}

export type Stage3RegenMode = 'full' | 'format_only' | 'story_clarity';

export async function generateContiFromPunchline(params: {
  workspace: Workspace;
  plan: PreGenerationPlan;
  punchlineIdea: string;
  mustIncludeProps?: string[];
  pastSummaries?: string[];
  feedback?: string;
  /** dull·형식 재시도 — 3a 스킵(format_only) 또는 3a 부분 수정(story_clarity) */
  existingStoryDraft?: StoryDraft;
  regenMode?: Stage3RegenMode;
  onStage?: (stage: string) => void | Promise<void>;
}): Promise<ContiGenerationResult> {
  const sonnetModel = await getContiSonnetModel();
  const haikuModel = await getContiHaikuModel();
  const ctx = buildPunchlinePromptContext(params);
  const regenMode = params.regenMode ?? 'full';
  const punchlineIdea = params.punchlineIdea.trim();

  if (regenMode === 'format_only' && !params.existingStoryDraft) {
    throw new Error('3b-only 재생성 — existingStoryDraft(storyDraft)가 필요합니다');
  }
  if (regenMode === 'story_clarity' && !params.existingStoryDraft) {
    throw new Error('story_clarity 재생성 — existingStoryDraft(storyDraft)가 필요합니다');
  }

  let storyDraft: StoryDraft | undefined;
  const comprehensionWarnings: string[] = [];
  let lastErr: unknown;

  for (let storyAttempt = 0; storyAttempt <= MAX_STORY_REGEN_ON_FORMAT_FAIL; storyAttempt++) {
    if (regenMode === 'format_only') {
      storyDraft = params.existingStoryDraft;
    } else if (regenMode === 'story_clarity') {
      if (storyAttempt === 0) {
        await reportStage(ctx, '3a 이해도·유머 보완 (storyDraft)');
        storyDraft = await regenerateStoryDraftForClarity({
          existing: params.existingStoryDraft!,
          punchlineIdea,
          feedback: params.feedback ?? STORY_COMPREHENSION_REGEN_FEEDBACK,
          model: sonnetModel,
        });
      } else {
        await reportStage(ctx, '3a 재생성 (3b 형식 변환 반복 실패)');
        storyDraft = await generateStoryDraft(
          {
            ...ctx,
            feedback:
              (ctx.feedback ? `${ctx.feedback} ` : '') +
              '이전 이야기는 짧은 영상 샷·시간 형식에 맞지 않았다. 같은 펀치라인으로 더 압축된 흐름으로 다시 서술하라.',
          },
          sonnetModel,
        );
        const comprehension = await ensureStoryDraftComprehension(ctx, storyDraft, punchlineIdea, sonnetModel);
        storyDraft = comprehension.draft;
        comprehensionWarnings.push(...comprehension.warnings);
      }
    } else if (!storyDraft) {
      await reportStage(ctx, '3a단계 자유 서술 (재미)');
      storyDraft = await generateStoryDraft(ctx, sonnetModel);
      const comprehension = await ensureStoryDraftComprehension(ctx, storyDraft, punchlineIdea, sonnetModel);
      storyDraft = comprehension.draft;
      comprehensionWarnings.push(...comprehension.warnings);
    } else if (storyAttempt > 0) {
      await reportStage(ctx, '3a단계 재생성 (3b 형식 변환 반복 실패)');
      storyDraft = await generateStoryDraft(
        {
          ...ctx,
          feedback:
            (ctx.feedback ? `${ctx.feedback} ` : '') +
            '이전 이야기는 짧은 영상 샷·시간 형식에 맞지 않았다. 같은 펀치라인으로 더 압축된 흐름으로 다시 서술하라.',
        },
        sonnetModel,
      );
      const comprehension = await ensureStoryDraftComprehension(ctx, storyDraft, punchlineIdea, sonnetModel);
      storyDraft = comprehension.draft;
      comprehensionWarnings.push(...comprehension.warnings);
    }

    const foundation = storyDraftToFoundation(storyDraft!);
    const shotCtx: PromptContext = { ...ctx, storyDraft, feedback: params.feedback };

    try {
      const conti = await generateContiShotsFromFoundation({
        ctx: shotCtx,
        foundation,
        haikuModel,
        initialFeedback: params.feedback,
      });
      const mergedWarnings = [...(conti.contentWarnings ?? []), ...comprehensionWarnings];
      return {
        ...conti,
        storyDraft,
        contentWarnings: mergedWarnings.length ? mergedWarnings : undefined,
      };
    } catch (err) {
      lastErr = err;
      if (
        err instanceof ContiValidationError &&
        storyAttempt < MAX_STORY_REGEN_ON_FORMAT_FAIL &&
        regenMode === 'full'
      ) {
        storyDraft = undefined;
        continue;
      }
      throw err;
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error('3단계 콘티 생성 실패');
}

export { buildEvoLinkPrompt as buildKlingPrompt };
