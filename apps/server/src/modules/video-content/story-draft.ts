import type { VideoConti } from './types.js';
import { buildHookTypePromptBlock, extractSectionBody } from './persona-axis.js';
import { buildCharacterNamingRule } from './conti-validation.js';
import { buildYeonunFortuneDialogueRule } from './screen-text-constraint.js';
import { VIDEO_CHARACTER_JSON_SCHEMA_SNIPPET } from './character-appearance.js';
import type { GenerationConditions } from './types.js';
import type { Workspace } from '@huma/shared';

/** 3a 출력 + 3b 입력 — foundation 호환 구조 */
export interface ContiFoundation {
  locationKeyword: string;
  timeOfDay: string;
  characters: VideoConti['characters'];
  location: string;
  lighting: string;
  timeOfDayVisual: string;
  scenarioSummary: string;
  fullText: string;
}

/** 3a단계 — 자유 서술 + 최소 구조 (3b 형식 변환 입력) */
export interface StoryDraft {
  narrativeProse: string;
  locationKeyword: string;
  timeOfDay: string;
  characters: VideoConti['characters'];
  location: string;
  lighting: string;
  timeOfDayVisual: string;
  scenarioSummary: string;
}

export const STORY_DRAFT_MAX_TOKENS = 4096;
/** 3b 검증 실패 후 3a 재생성 최대 횟수 */
export const MAX_STORY_REGEN_ON_FORMAT_FAIL = 1;

export function storyDraftToFoundation(draft: StoryDraft): ContiFoundation {
  return {
    locationKeyword: draft.locationKeyword,
    timeOfDay: draft.timeOfDay,
    characters: draft.characters,
    location: draft.location,
    lighting: draft.lighting,
    timeOfDayVisual: draft.timeOfDayVisual,
    scenarioSummary: draft.scenarioSummary,
    fullText: `${draft.narrativeProse}\n\n${draft.scenarioSummary}`.trim(),
  };
}

function normalizeStoryDraftFields(
  raw: Partial<StoryDraft> & { narrativeProse?: unknown },
  fallbackProse?: string,
): StoryDraft {
  const narrativeProse =
    String(raw.narrativeProse ?? fallbackProse ?? '').trim() ||
    String(fallbackProse ?? '').trim() ||
    '이전 콘티 서술';
  return {
    narrativeProse,
    locationKeyword: String(raw.locationKeyword ?? ''),
    timeOfDay: String(raw.timeOfDay ?? ''),
    characters: Array.isArray(raw.characters) ? raw.characters : [],
    location: String(raw.location ?? ''),
    lighting: String(raw.lighting ?? ''),
    timeOfDayVisual: String(raw.timeOfDayVisual ?? raw.timeOfDay ?? ''),
    scenarioSummary: String(raw.scenarioSummary ?? narrativeProse.slice(0, 200)),
  };
}

export function parseStoryDraft(parsed: Record<string, unknown>): StoryDraft {
  const narrativeProse = String(parsed.narrativeProse ?? parsed.narrative ?? parsed.story ?? '').trim();
  if (!narrativeProse) {
    throw new Error('3a단계 — narrativeProse(이야기 서술)가 비어 있습니다');
  }
  return normalizeStoryDraftFields({
    narrativeProse,
    locationKeyword: parsed.locationKeyword,
    timeOfDay: parsed.timeOfDay,
    characters: parsed.characters,
    location: parsed.location,
    lighting: parsed.lighting,
    timeOfDayVisual: parsed.timeOfDayVisual ?? parsed.timeOfDay,
    scenarioSummary: parsed.scenarioSummary,
  } as Partial<StoryDraft>);
}

/** conti_json / legacy conti → 3b-only 재생성용 draft */
export function contiToStoryDraft(
  conti: VideoConti & { storyDraft?: StoryDraft; locationKeyword?: string },
): StoryDraft {
  const embeddedProse = String(conti.storyDraft?.narrativeProse ?? '').trim();
  if (embeddedProse) {
    return normalizeStoryDraftFields(conti.storyDraft!, embeddedProse);
  }
  const prose = (conti.fullText || conti.scenarioSummary || '').trim();
  return normalizeStoryDraftFields(
    {
      locationKeyword: conti.locationKeyword,
      timeOfDay: conti.timeOfDay,
      characters: conti.characters,
      location: conti.location,
      lighting: conti.lighting,
      timeOfDayVisual: conti.timeOfDay,
      scenarioSummary: conti.scenarioSummary,
    },
    prose || '이전 콘티 서술',
  );
}

function buildSlimHumorContext(params: {
  workspace: Workspace;
  conditions: GenerationConditions & { hookSubtype?: string };
  personaText?: string;
  serviceConstraintsFallback: string;
}): string {
  const { conditions, personaText, serviceConstraintsFallback } = params;
  const situationLine = conditions.situationAxis ? `- 상황축: ${conditions.situationAxis}\n` : '';
  const hookSubtypeLine =
    'hookSubtype' in conditions && conditions.hookSubtype
      ? `- hook_subtype: ${conditions.hookSubtype}\n`
      : '';

  const parts = [
    `이번 영상 조건 (고정):
- 관계축: ${conditions.relationshipAxis}
${situationLine}- 감정곡선: ${conditions.emotionCurve}
- 펀치라인 메커니즘(hook_type): ${conditions.hookType}
${hookSubtypeLine}`,
  ];

  if (personaText?.trim()) {
    const hookBlock = buildHookTypePromptBlock(personaText, conditions.hookType);
    if (hookBlock.trim()) parts.push(hookBlock.trim());
    const serviceBody = extractSectionBody(personaText, '서비스 제약');
    if (serviceBody.trim()) {
      parts.push(
        `서비스·재미 원칙 (스토리에 반영, 샷·시간 규칙은 3b에서 적용):\n${serviceBody.slice(0, 1400)}`,
      );
    }
  } else if (serviceConstraintsFallback.trim()) {
    parts.push(`서비스 제약:\n${serviceConstraintsFallback.slice(0, 800)}`);
  }

  return parts.join('\n\n');
}

export function buildStoryDraftPrompt(params: {
  workspace: Workspace;
  conditions: GenerationConditions & { hookSubtype?: string };
  personaText?: string;
  serviceConstraintsFallback: string;
  punchlineIdea: string;
  mustIncludeProps?: string[];
  yeonunProductContext?: string;
  quizContentContext?: string;
  pastSummaries?: string[];
  charBlock: string;
  feedback?: string;
}): string {
  const {
    workspace,
    punchlineIdea,
    mustIncludeProps,
    yeonunProductContext,
    quizContentContext,
    pastSummaries,
    charBlock,
    feedback,
  } = params;

  const yeonunFortuneBlock =
    workspace === 'yeonun' ? `\n${buildYeonunFortuneDialogueRule()}\n` : '';

  const pastBlock =
    pastSummaries?.length ?
      `\n과거 시나리오 (겹치지 말 것):\n${pastSummaries.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n`
    : '';

  const productBlock = yeonunProductContext ? `\n${yeonunProductContext}\n` : '';
  const quizBlock = quizContentContext ? `\n${quizContentContext}\n` : '';
  const propsBlock = mustIncludeProps?.length
    ? `\n이야기에 자연스럽게 넣을 핵심 소재(촬영 가능한 사물): ${mustIncludeProps.join(', ')}\n`
    : '';
  const feedbackBlock = feedback ? `\n⚠️ 보완 요청: ${feedback}\n` : '';

  return `한국어 숏폼 — 3a단계: 펀치라인을 가장 재미있게 드러내는 **이야기 흐름**만 작성한다.

⚠️ 이 단계 금지: 샷 개수, 초 단위 시간 배분, 대사 글자 수 제한, camera/action/dialogue JSON.
오직 등장인물·장소·사건 전개·대사 **내용**(말할 것)에만 집중한다. 형식은 다음 3b단계에서 처리한다.
연운·운세 setup은 narrativeProse·대사 **내용**에 읽은 문구를 넣는다. 3b에서 샷별 초×8자 예산에 맞게 압축·분배한다.
${yeonunFortuneBlock}

선택된 펀치라인(결말 고정 — 반드시 이 결말로 수렴, 변경 금지):
${punchlineIdea}

${buildSlimHumorContext(params)}${charBlock}${productBlock}${quizBlock}${propsBlock}${pastBlock}${feedbackBlock}

지시:
- narrativeProse에 **setup → 발견/전환 → 펀치** 3 beat가 순서대로 드러나게 서술한다 (시청자가 "그래서 뭐?" 없이 이해 가능).
- narrativeProse에 사건 전개·인물 반응·핵심 대사 내용을 **문단 형식**으로 충분히 서술한다.
- narrativeProse·모든 문자열 값 안의 인용부호는 **「」** 를 쓰고, ASCII 큰따옴표(")는 JSON 이스케이프(\\")만 사용. 문자열 안에 실제 줄바꿈 금지(한 줄로 쓰거나 \\n).
- 펀치라인 직전 setup과 반전/펀치 반응이 분명해야 한다.
- 등장인물 이름·외형은 새로 창작. ${buildCharacterNamingRule()}

JSON만 출력:
{
  "narrativeProse": "자유 서술 (여러 문단 가능, 대사 내용 포함)",
  "locationKeyword": "string",
  "timeOfDay": "string",
  "characters": [${VIDEO_CHARACTER_JSON_SCHEMA_SNIPPET}],
  "location": "구체적 장소",
  "lighting": "조명",
  "timeOfDayVisual": "시각적 시간대",
  "scenarioSummary": "2~3문장 요약"
}`;
}

export function buildFormatConversionIntro(storyDraft: StoryDraft): string {
  const prose = String(storyDraft.narrativeProse ?? '').trim();
  if (!prose) {
    throw new Error('3b단계 — storyDraft.narrativeProse가 비어 있습니다');
  }
  return `3a단계 확정 이야기 (내용·펀치라인·대사 의미 변경 금지 — ${prose.length}자):

${prose}

---
등장인물·장소 (고정):
${JSON.stringify(
  {
    characters: storyDraft.characters,
    location: storyDraft.location,
    lighting: storyDraft.lighting,
    timeOfDay: storyDraft.timeOfDayVisual || storyDraft.timeOfDay,
    scenarioSummary: storyDraft.scenarioSummary,
  },
  null,
  2,
)}`;
}
