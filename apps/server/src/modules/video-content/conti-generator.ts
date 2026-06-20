import type { Workspace } from '@huma/shared';
import { askClaudeWithModel } from '../../lib/anthropic-client.js';
import { getMainClaudeModel } from '../../lib/ai-engine.js';
import {
  enforcePunchlineShotMinDuration,
  validateCutTypeMatchesRawShots,
  validatePunchlineShotMinDuration,
  validateAllShotsMinDuration,
  buildMinShotDurationRule,
  buildDurationShotCountGuide,
  ContiValidationError,
  MAX_SHOT_DURATION_REGENERATION_ATTEMPTS,
  PUNCHLINE_MIN_DURATION_SEC,
} from './conti-validation.js';
import { normalizeMultiShotConti, buildEvoLinkPrompt } from './evolink.js';
import { EVOLINK_PROMPT_LENGTH_GUIDANCE } from './prompt-length.js';
import { buildSixShotTimeline } from './shot-timing.js';
import type { GenerationConditions, VideoConti, VideoPersonaConfig } from './types.js';

function parseJsonBlock(raw: string): unknown {
  const trimmed = raw.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fence ? fence[1]!.trim() : trimmed;
  return JSON.parse(body);
}

function formatTimelineGuide(duration: number): string {
  const timeline = buildSixShotTimeline(duration);
  return timeline
    .map((t) => `샷${t.shotNumber}(${t.startSec}~${t.endSec}초, ${t.durationSec}초)`)
    .join(' → ');
}

function buildContiPrompt(params: {
  workspace: Workspace;
  config: VideoPersonaConfig;
  conditions: GenerationConditions;
  feedback?: string;
  pastSummaries?: string[];
}): string {
  const { conditions, config, feedback, pastSummaries } = params;
  const charBlock =
    params.workspace === 'panana' && conditions.characterDescription
      ? `\n파나나 캐릭터 "${conditions.characterName}" 외형/톤/말버릇 (고정):\n${conditions.characterDescription}\n`
      : params.workspace === 'panana'
        ? ''
        : '\n등장인물은 매번 새로운 일반인으로 창작. 서비스 캐릭터 비등장.\n';

  const pastBlock =
    pastSummaries?.length ?
      `\n과거 시나리오 (겹치지 말 것):\n${pastSummaries.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n`
    : '';

  const feedbackBlock = feedback ? `\n⚠️ 재작성 요청: ${feedback}\n` : '';

  const punchlineDurationRule = `펀치라인이 들어가는 샷(마지막 또는 마지막 직전)은 대사를 끝까지 전달할 수 있도록 최소 ${PUNCHLINE_MIN_DURATION_SEC}초를 확보하라. 영상이 ${conditions.duration}초로 짧아도 이 최소 시간은 반드시 지켜라.`;

  const minShotDurationRule = buildMinShotDurationRule(conditions.duration);
  const shotCountGuide = buildDurationShotCountGuide(conditions.duration);

  const defaultMultiShotGuide = `${shotCountGuide}
${minShotDurationRule}

6샷 멀티샷 (${conditions.duration}초) — EvoLink용 정규 타임라인: ${formatTimelineGuide(conditions.duration)}
shots 배열은 ${conditions.duration <= 9 ? '4~5개' : conditions.duration <= 11 ? '4~6개' : '5~6개'} 권장. startSec/endSec 합이 ${conditions.duration}과 일치.
짧은 영상에서 샷 개수를 무리하게 늘리지 말 것. 각 샷 구간은 최소 1.5초 이상.
최소 4샷(권장: 샷1,3,4,5)에 대사. 샷3은 행동+대사+디테일 밀도 높게(가장 긴 구간 중 하나).
펀치라인은 샷5 후반부에서 터지도록. 말하는 샷과 보여주는 샷 교차.
${punchlineDurationRule}
${EVOLINK_PROMPT_LENGTH_GUIDANCE}`;

  const defaultSingleShotGuide = `싱글샷 연속 (${conditions.duration}초, 4~5 시간 비트로 대사/행동 순차 전개, 컷 전환 없음).
shots 배열은 1개만 — 컷 전환·다중 샷 금지.
${minShotDurationRule}
${punchlineDurationRule}
${EVOLINK_PROMPT_LENGTH_GUIDANCE}`;

  const shotGuide =
    config.shotStructure?.trim() ??
    (conditions.cutType === 'multi_shot' ? defaultMultiShotGuide : defaultSingleShotGuide);

  const cutRuleBlock = config.cutTypeRule?.trim()
    ? `\n컷 구성 규칙 (페르소나):\n${config.cutTypeRule.trim()}\n`
    : '';

  const situationLine = conditions.situationAxis
    ? `- 상황축: ${conditions.situationAxis}\n`
    : '';

  const storyAxis =
    conditions.situationAxis != null
      ? `[${conditions.relationshipAxis}] 관계 · [${conditions.situationAxis}] 상황`
      : `[${conditions.relationshipAxis}] 관계`;

  return `한국어 숏폼 영상 콘티를 JSON으로 작성하라.

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
등장인물 이름·외형·구체적 상황·대사는 전부 새로 창작. 과거 시나리오와 겹치지 않게.
[${conditions.hookType}] 방식의 펀치라인이 샷5 후반(멀티샷) 또는 마지막 비트(싱글샷)에 터지도록.
location_keyword와 time_of_day도 새로 창작해서 JSON에 포함."

${shotGuide}

영상 1건 내 등장인물 외형·장소·조명·시간대는 절대 변경 금지.

JSON 스키마 (반드시 준수):
{
  "locationKeyword": "string",
  "timeOfDay": "string",
  "characters": [{"label":"A","age":"30대","gender":"여","hair":"...","outfit":"...","shoes":"..."}],
  "location": "구체적 장소 묘사",
  "lighting": "조명",
  "timeOfDayVisual": "시각적 시간대",
  "shots": [{"shotNumber":1,"startSec":0,"endSec":3,"camera":"와이드","action":"...","dialogue":"..."}],
  "scenarioSummary": "2~3문장 요약",
  "fullText": "등장인물 설정+시나리오+전체 대사를 하나의 텍스트로"
}`;
}

export async function generateConti(params: {
  workspace: Workspace;
  config: VideoPersonaConfig;
  conditions: GenerationConditions;
  feedback?: string;
  pastSummaries?: string[];
}): Promise<VideoConti & { locationKeyword: string; timeOfDay: string }> {
  const model = (await getMainClaudeModel()) || 'claude-sonnet-4-6';
  const prompt = buildContiPrompt(params);
  const raw = await askClaudeWithModel({ model, max_tokens: 4096, prompt });
  if (!raw) throw new Error('콘티 LLM 응답 없음');

  const parsed = parseJsonBlock(raw) as Record<string, unknown>;
  let shots = (parsed.shots as VideoConti['shots']) ?? [];

  let conti: VideoConti = {
    characters: (parsed.characters as VideoConti['characters']) ?? [],
    location: String(parsed.location ?? ''),
    lighting: String(parsed.lighting ?? ''),
    timeOfDay: String(parsed.timeOfDayVisual ?? parsed.timeOfDay ?? ''),
    cutType: params.conditions.cutType,
    duration: params.conditions.duration,
    shots,
    scenarioSummary: String(parsed.scenarioSummary ?? ''),
    fullText: String(parsed.fullText ?? parsed.scenarioSummary ?? ''),
  };

  const cutCheck = validateCutTypeMatchesRawShots(params.conditions.cutType, shots);
  if (!cutCheck.ok) {
    throw new ContiValidationError(cutCheck.feedback);
  }

  if (params.conditions.cutType === 'single_shot' && conti.shots.length === 1) {
    const s = conti.shots[0]!;
    if (s.endSec <= s.startSec) {
      conti.shots[0] = { ...s, shotNumber: 1, startSec: 0, endSec: params.conditions.duration };
    }
  }

  if (params.conditions.cutType === 'multi_shot') {
    conti = normalizeMultiShotConti(conti, params.conditions.duration);
  }

  conti = enforcePunchlineShotMinDuration(conti);
  const punchCheck = validatePunchlineShotMinDuration(conti);
  if (!punchCheck.ok) {
    throw new ContiValidationError(punchCheck.feedback);
  }

  const shotDurCheck = validateAllShotsMinDuration(conti);
  if (!shotDurCheck.ok) {
    throw new ContiValidationError(shotDurCheck.feedback, {
      maxAttempts: MAX_SHOT_DURATION_REGENERATION_ATTEMPTS,
      holdOnFailure: true,
    });
  }

  return {
    ...conti,
    locationKeyword: String(parsed.locationKeyword ?? params.conditions.locationKeyword),
    timeOfDay: conti.timeOfDay,
  };
}

export { buildEvoLinkPrompt as buildKlingPrompt };
