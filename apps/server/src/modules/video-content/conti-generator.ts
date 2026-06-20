import type { Workspace } from '@huma/shared';
import { askClaudeWithModel } from '../../lib/anthropic-client.js';
import { getMainClaudeModel } from '../../lib/ai-engine.js';
import {
  enforcePunchlineShotMinDuration,
  validateCutTypeMatchesRawShots,
  validatePunchlineShotMinDuration,
  validateAllShotsMinDuration,
  findAdjacentDuplicateShotIndices,
  findRawShotQualityIssues,
  findIncompleteLastShotIndex,
  validateCharacterNameConsistency,
  extractCharacterNamesForStorage,
  buildMultiShotCompositionGuide,
  buildShotContentRule,
  buildSingleShotFoundationCutRule,
  buildMultiShotFoundationCutRule,
  buildSingleShotGuide,
  buildCharacterNamingRule,
  buildCameraActionNoRepeatRule,
  buildSentenceCompleteRule,
  buildEmptyShotContentFeedback,
  buildAdjacentDuplicateFeedback,
  buildShotFillPrompt,
  SINGLE_SHOT_CUT_MISMATCH_FEEDBACK,
  ContiValidationError,
  CONTI_FOUNDATION_MAX_TOKENS,
  CONTI_SHOTS_MAX_TOKENS,
  CONTI_SINGLE_SHOTS_MAX_TOKENS,
  CONTI_SHOT_FILL_MAX_TOKENS,
  MAX_SHOT_DURATION_REGENERATION_ATTEMPTS,
  MAX_EMPTY_CONTENT_REGENERATION_ATTEMPTS,
  MAX_SINGLE_SHOT_CUT_REGENERATION_ATTEMPTS,
  MAX_ADJACENT_DUPLICATE_PATCH_ATTEMPTS,
  MAX_SHOT_QUALITY_PATCH_ATTEMPTS,
  PUNCHLINE_MIN_DURATION_SEC,
  SHOT_CONTENT_MIN_CHARS,
} from './conti-validation.js';
import { normalizeMultiShotConti, normalizeSingleShotConti, buildEvoLinkPrompt, getDefaultShotAction } from './evolink.js';
import { EVOLINK_PROMPT_LENGTH_GUIDANCE } from './prompt-length.js';
import { getShotCountBounds } from './shot-timing.js';
import type { GenerationConditions, VideoConti, VideoContiShot, VideoPersonaConfig } from './types.js';

export interface ContiGenerationResult extends VideoConti {
  locationKeyword: string;
  timeOfDay: string;
  /** 기본 action 대체 등 — 콘티는 완성되나 운영자 경고용 */
  contentWarnings?: string[];
  /** 마지막 샷 문장 미완결 — max_tokens 부족 신호 */
  lastShotIncompleteDetected?: boolean;
  /** A/B 라벨 제외 실제 부여 이름 — history.character_names 저장용 */
  characterNames?: string[];
}

interface ContiFoundation {
  locationKeyword: string;
  timeOfDay: string;
  characters: VideoConti['characters'];
  location: string;
  lighting: string;
  timeOfDayVisual: string;
  scenarioSummary: string;
  fullText: string;
}

interface PromptContext {
  workspace: Workspace;
  config: VideoPersonaConfig;
  conditions: GenerationConditions;
  feedback?: string;
  pastSummaries?: string[];
  onStage?: (stage: string) => void | Promise<void>;
}

async function reportStage(ctx: PromptContext, stage: string): Promise<void> {
  await ctx.onStage?.(stage);
}

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
  retryHint?: string;
}): Promise<Record<string, unknown>> {
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const prompt =
      attempt === 0 || !params.retryHint
        ? params.prompt
        : `${params.prompt}\n\n⚠️ JSON 파싱 실패. 유효한 JSON만 출력하고 대사 속 따옴표는 \\" 로 이스케이프하라.\n${params.retryHint}`;
    try {
      const raw = await askClaudeWithModel({ model: params.model, max_tokens: params.max_tokens, prompt });
      if (!raw) throw new Error('LLM 응답 없음');
      return parseJsonBlock(raw) as Record<string, unknown>;
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      const retryable =
        err instanceof SyntaxError ||
        lastErr.message.includes('JSON') ||
        lastErr.message.includes('Unexpected');
      if (attempt === 0 && retryable) continue;
      throw lastErr;
    }
  }
  throw lastErr ?? new Error('JSON 파싱 실패');
}

function buildMultiShotGuide(ctx: PromptContext): string {
  const { conditions, config } = ctx;
  const punchlineDurationRule = `펀치라인이 들어가는 샷(고정 번호 없음 — 시나리오 중후반 적절한 샷)은 대사를 끝까지 전달할 수 있도록 최소 ${PUNCHLINE_MIN_DURATION_SEC}초를 확보하라.`;

  const personaGuide = config.shotStructure?.trim();
  const baseGuide = personaGuide ?? buildMultiShotCompositionGuide(conditions.duration);

  return `${baseGuide}
${buildShotContentRule()}
${punchlineDurationRule}
shots 배열 길이는 ${getShotCountBounds(conditions.duration).min}~${getShotCountBounds(conditions.duration).max}개. startSec/endSec 합 = ${conditions.duration}. 각 action ${SHOT_CONTENT_MIN_CHARS}자 이상.
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

  return `한국어 숏폼 영상 콘티 1단계 — 시나리오·등장인물·장소만 JSON으로 작성하라 (샷/shots 없음).

이번 영상 조건:
- 관계축: ${conditions.relationshipAxis}
${situationLine}- 감정곡선: ${conditions.emotionCurve}
- 펀치라인 메커니즘: ${conditions.hookType}
- cut_type: ${conditions.cutType}
- duration: ${conditions.duration}초
${charBlock}
${config.serviceConstraints}
${cutRuleBlock}${pastBlock}${feedbackBlock}

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
  "characters": [{"label":"A","name":"민수(선택)","age":"30대","gender":"여","hair":"...","outfit":"...","shoes":"..."}],
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

  return `한국어 숏폼 영상 콘티 2단계 — 1단계 설정을 바탕으로 샷별 camera/action/dialogue만 JSON으로 작성하라.
${cutTypeNote}
1단계 설정 (변경 금지):
${JSON.stringify(foundation, null, 2)}
${feedbackBlock}

샷 구성 규칙:
${shotGuide}

JSON 스키마:
${buildShotsJsonSchema(ctx.conditions)}`;
}

function buildShotPatchPrompt(
  ctx: PromptContext,
  foundation: ContiFoundation,
  conti: VideoConti,
  invalidIndices: number[],
  reason?: string,
): string {
  const shotNumbers = invalidIndices.map((i) => i + 1);
  const existing = invalidIndices.map((i) => {
    const s = conti.shots[i]!;
    const prev = i > 0 ? conti.shots[i - 1] : null;
    const prevLine = prev
      ? `직전 샷${i}: action=${prev.action ?? ''}, dialogue=${prev.dialogue ?? ''}`
      : '';
    return `샷${i + 1}: camera=${s.camera ?? ''}, action=${s.action ?? ''}, dialogue=${s.dialogue ?? ''}${prevLine ? `\n  ${prevLine}` : ''}`;
  });

  const reasonBlock = reason ? `\n보완 사유: ${reason}\n` : ctx.feedback ? `\n${ctx.feedback}\n` : '';

  return `다음 영상 설정과 기존 콘티에서 지정 샷만 보완하라.

설정:
${JSON.stringify(foundation, null, 2)}
${reasonBlock}

보완 대상:
${existing.join('\n')}

${buildShotFillPrompt(shotNumbers)}
${buildSentenceCompleteRule()}
${buildCameraActionNoRepeatRule()}
${buildCharacterNamingRule()}

JSON:
{
  "patches": [{"shotNumber": ${shotNumbers[0]}, "camera": "...", "action": "... (${SHOT_CONTENT_MIN_CHARS}자 이상)", "dialogue": "..."}]
}`;
}

function parseFoundation(parsed: Record<string, unknown>): ContiFoundation {
  return {
    locationKeyword: String(parsed.locationKeyword ?? ''),
    timeOfDay: String(parsed.timeOfDay ?? ''),
    characters: (parsed.characters as VideoConti['characters']) ?? [],
    location: String(parsed.location ?? ''),
    lighting: String(parsed.lighting ?? ''),
    timeOfDayVisual: String(parsed.timeOfDayVisual ?? parsed.timeOfDay ?? ''),
    scenarioSummary: String(parsed.scenarioSummary ?? ''),
    fullText: String(parsed.fullText ?? parsed.scenarioSummary ?? ''),
  };
}

function assembleConti(
  foundation: ContiFoundation,
  shots: VideoContiShot[],
  conditions: GenerationConditions,
  fullTextOverride?: string,
): VideoConti {
  return {
    characters: foundation.characters,
    location: foundation.location,
    lighting: foundation.lighting,
    timeOfDay: foundation.timeOfDayVisual || foundation.timeOfDay,
    cutType: conditions.cutType,
    duration: conditions.duration,
    shots,
    scenarioSummary: foundation.scenarioSummary,
    fullText: fullTextOverride?.trim() || foundation.fullText,
  };
}

function applyDefaultToRawShots(conti: VideoConti, indices: number[]): VideoConti {
  const shots = conti.shots.map((s, i) => {
    if (!indices.includes(i)) return s;
    return {
      ...s,
      shotNumber: s.shotNumber || i + 1,
      camera: s.camera?.trim() || (i === 0 || i === conti.shots.length - 1 ? '와이드' : '미디엄'),
      action: getDefaultShotAction(i, conti.shots.length),
    };
  });
  return { ...conti, shots };
}

function mergeShotPatches(conti: VideoConti, patches: VideoContiShot[]): VideoConti {
  const byNumber = new Map(patches.map((p) => [p.shotNumber, p]));
  const shots = conti.shots.map((s, i) => {
    const patch = byNumber.get(s.shotNumber) ?? byNumber.get(i + 1);
    if (!patch) return s;
    return {
      ...s,
      camera: patch.camera?.trim() || s.camera,
      action: patch.action?.trim() || s.action,
      dialogue: patch.dialogue?.trim() || s.dialogue,
    };
  });
  return { ...conti, shots };
}

async function generateFoundation(ctx: PromptContext, model: string): Promise<ContiFoundation> {
  const parsed = await callClaudeJson({
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
): Promise<{ shots: VideoContiShot[]; fullText?: string }> {
  const maxTokens =
    ctx.conditions.cutType === 'single_shot' ? CONTI_SINGLE_SHOTS_MAX_TOKENS : CONTI_SHOTS_MAX_TOKENS;
  const parsed = await callClaudeJson({
    model,
    max_tokens: maxTokens,
    prompt: buildShotsPrompt(ctx, foundation),
  });
  const shots = (parsed.shots as VideoContiShot[]) ?? [];
  const fullText = parsed.fullText ? String(parsed.fullText) : undefined;
  return { shots, fullText };
}

async function regenerateShotsOnly(
  ctx: PromptContext,
  foundation: ContiFoundation,
  model: string,
  feedback: string,
): Promise<VideoConti> {
  const { shots, fullText } = await generateShots({ ...ctx, feedback }, foundation, model);
  return assembleConti(foundation, shots, ctx.conditions, fullText);
}

async function fillSpecificShots(
  ctx: PromptContext,
  foundation: ContiFoundation,
  conti: VideoConti,
  invalidIndices: number[],
  model: string,
  reason?: string,
): Promise<VideoConti> {
  const parsed = await callClaudeJson({
    model,
    max_tokens: CONTI_SHOT_FILL_MAX_TOKENS,
    prompt: buildShotPatchPrompt(ctx, foundation, conti, invalidIndices, reason),
  });
  const patches = (parsed.patches as VideoContiShot[]) ?? [];
  return mergeShotPatches(conti, patches);
}

async function patchShotIssues(
  ctx: PromptContext,
  foundation: ContiFoundation,
  conti: VideoConti,
  indices: number[],
  feedback: string,
  model: string,
): Promise<VideoConti> {
  return fillSpecificShots({ ...ctx, feedback }, foundation, conti, indices, model, feedback);
}

async function recoverShotQualityIssues(
  ctx: PromptContext,
  foundation: ContiFoundation,
  conti: VideoConti,
  model: string,
  options: { allowEmptyFullRetry: boolean },
): Promise<{ conti: VideoConti; warnings: string[] }> {
  const warnings: string[] = [];
  let current = conti;
  let emptyFullRetries = 0;
  let narrowPatchAttempts = 0;
  const maxNarrow =
    MAX_SHOT_QUALITY_PATCH_ATTEMPTS + MAX_ADJACENT_DUPLICATE_PATCH_ATTEMPTS + 1;

  while (true) {
    const qualityIssues = findRawShotQualityIssues(current);
    const duplicates = findAdjacentDuplicateShotIndices(current);
    const emptyIssues = qualityIssues.filter((issue) => issue.kind === 'empty');
    const nonEmptyQuality = qualityIssues.filter((issue) => issue.kind !== 'empty');

    if (emptyIssues.length === 0 && nonEmptyQuality.length === 0 && duplicates.length === 0) {
      break;
    }

    if (
      options.allowEmptyFullRetry &&
      emptyIssues.length > 0 &&
      emptyFullRetries < MAX_EMPTY_CONTENT_REGENERATION_ATTEMPTS
    ) {
      emptyFullRetries += 1;
      const shotsFeedback = buildEmptyShotContentFeedback(emptyIssues[0]!.index + 1);
      const { shots, fullText } = await generateShots({ ...ctx, feedback: shotsFeedback }, foundation, model);
      current = assembleConti(foundation, shots, ctx.conditions, fullText ?? current.fullText);
      continue;
    }

    let patchIdx: number;
    let feedback: string;

    if (duplicates.length > 0) {
      patchIdx = duplicates[0]!;
      feedback = buildAdjacentDuplicateFeedback(patchIdx + 1);
    } else if (nonEmptyQuality.length > 0) {
      const issue = nonEmptyQuality[0]!;
      patchIdx = issue.index;
      feedback = issue.feedback;
    } else {
      patchIdx = emptyIssues[0]!.index;
      feedback = emptyIssues[0]!.feedback;
    }

    if (narrowPatchAttempts < maxNarrow) {
      narrowPatchAttempts += 1;
      current = await patchShotIssues(ctx, foundation, current, [patchIdx], feedback, model);
      continue;
    }

    const fallbackIndices = [
      ...new Set([
        ...emptyIssues.map((issue) => issue.index),
        ...nonEmptyQuality.map((issue) => issue.index),
        ...duplicates,
      ]),
    ];
    current = applyDefaultToRawShots(current, fallbackIndices);
    const nums = fallbackIndices.map((i) => i + 1).join(', ');
    warnings.push(
      `샷 ${nums} 자동 보완 실패 — 기본 action으로 대체했습니다. 콘티 검토 후 필요 시 재생성하세요.`,
    );
    break;
  }

  return { conti: current, warnings };
}

async function recoverRawShotContent(
  ctx: PromptContext,
  foundation: ContiFoundation,
  conti: VideoConti,
  model: string,
): Promise<{ conti: VideoConti; warnings: string[] }> {
  return recoverShotQualityIssues(ctx, foundation, conti, model, { allowEmptyFullRetry: true });
}

async function recoverAdjacentDuplicates(
  ctx: PromptContext,
  foundation: ContiFoundation,
  conti: VideoConti,
  model: string,
): Promise<{ conti: VideoConti; warnings: string[] }> {
  return recoverShotQualityIssues(ctx, foundation, conti, model, { allowEmptyFullRetry: false });
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
  model: string,
): Promise<{ conti: VideoConti; warnings: string[] }> {
  const warnings: string[] = [];
  let current = conti;
  let cutRetries = 0;

  while (true) {
    const check = validateCutTypeMatchesRawShots(ctx.conditions.cutType, current.shots);
    if (check.ok) return { conti: current, warnings };

    if (ctx.conditions.cutType === 'single_shot') {
      const normalized = applyCutTypeNormalization(current, ctx.conditions);
      current = normalized.conti;
      warnings.push(...normalized.warnings);
      const afterNormalize = validateCutTypeMatchesRawShots(ctx.conditions.cutType, current.shots);
      if (afterNormalize.ok) return { conti: current, warnings };

      if (cutRetries < MAX_SINGLE_SHOT_CUT_REGENERATION_ATTEMPTS) {
        cutRetries += 1;
        await reportStage(ctx, `single_shot cut 재생성 ${cutRetries}/${MAX_SINGLE_SHOT_CUT_REGENERATION_ATTEMPTS}`);
        current = await regenerateShotsOnly(ctx, foundation, model, SINGLE_SHOT_CUT_MISMATCH_FEEDBACK);
        const normAgain = applyCutTypeNormalization(current, ctx.conditions);
        current = normAgain.conti;
        warnings.push(...normAgain.warnings);
        continue;
      }
    }

    throw new ContiValidationError(check.feedback);
  }
}

export async function generateConti(params: PromptContext): Promise<ContiGenerationResult> {
  const model = (await getMainClaudeModel()) || 'claude-sonnet-4-6';
  await reportStage(params, '1단계 foundation LLM');
  const foundation = await generateFoundation(params, model);
  await reportStage(params, '2단계 shots LLM');
  const { shots, fullText } = await generateShots(params, foundation, model);

  let conti = assembleConti(foundation, shots, params.conditions, fullText);
  const contentWarnings: string[] = [];
  let lastShotIncompleteDetected = findIncompleteLastShotIndex(conti) != null;

  await reportStage(params, '샷 품질 보완');
  const recovered = await recoverRawShotContent(params, foundation, conti, model);
  conti = recovered.conti;
  contentWarnings.push(...recovered.warnings);

  if (params.conditions.cutType === 'multi_shot') {
    conti = normalizeMultiShotConti(conti, params.conditions.duration);
    const dupRecovered = await recoverAdjacentDuplicates(params, foundation, conti, model);
    conti = dupRecovered.conti;
    contentWarnings.push(...dupRecovered.warnings);
  } else {
    const normalized = applyCutTypeNormalization(conti, params.conditions);
    conti = normalized.conti;
    contentWarnings.push(...normalized.warnings);
  }

  await reportStage(params, 'cutType 정규화·검증');
  const cutEnsured = await ensureCutTypeMatches(params, foundation, conti, model);
  conti = cutEnsured.conti;
  contentWarnings.push(...cutEnsured.warnings);

  conti = enforcePunchlineShotMinDuration(conti);
  const punchCheck = validatePunchlineShotMinDuration(conti);
  if (!punchCheck.ok) {
    contentWarnings.push(`펀치라인 샷 길이 부족(통과): ${punchCheck.feedback}`);
  }

  const shotDurCheck = validateAllShotsMinDuration(conti);
  if (!shotDurCheck.ok) {
    throw new ContiValidationError(shotDurCheck.feedback, {
      maxAttempts: MAX_SHOT_DURATION_REGENERATION_ATTEMPTS,
      holdOnFailure: true,
      holdReason: 'shot_duration',
    });
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

  const characterNames = extractCharacterNamesForStorage(conti, params.conditions.characterName);

  return {
    ...conti,
    locationKeyword: foundation.locationKeyword,
    timeOfDay: conti.timeOfDay,
    contentWarnings: contentWarnings.length ? contentWarnings : undefined,
    lastShotIncompleteDetected: lastShotIncompleteDetected || undefined,
    characterNames: characterNames.length ? characterNames : undefined,
  };
}

export { buildEvoLinkPrompt as buildKlingPrompt };
