import { askClaudeWithModel } from '../../lib/anthropic-client.js';
import { getSubClaudeModel } from '../../lib/ai-engine.js';
import { callClaudeJsonWithRetry } from '../../lib/llm-json.js';
import type { StoryDraft } from './story-draft.js';
import { parseStoryDraft, STORY_DRAFT_MAX_TOKENS } from './story-draft.js';

export const MAX_STORY_COMPREHENSION_REGEN = 2;

export const STORY_COMPREHENSION_LIMIT_WARNING =
  '3a 이해도 보완 한계 — 경고 후 3b 진행 (setup→펀치 연결이 약할 수 있음)';

export const STORY_COMPREHENSION_REGEN_FEEDBACK =
  '3a 이야기를 끝까지 읽었을 때 "그래서 뭐?"가 남을 수 있다. setup→발견→펀치가 한 줄로 이어지게 narrativeProse·scenarioSummary·핵심 대사 내용을 보완하라. ' +
  '연운·운세 setup은 읽은 문구 전문을 대사 내용에 포함. 발견·반전 순간(알림 확인·카드·구독·오해 해소 등)을 빠뜨리지 말 것. 펀치라인 결말은 유지.';

export type StoryComprehensionVerdict = 'clear' | 'unclear';

const HAIKU_FALLBACK = 'claude-haiku-4-5-20251001';

export function formatStoryDraftForComprehension(storyDraft: StoryDraft, punchlineIdea: string): string {
  return [
    `펀치라인(결말 고정): ${punchlineIdea}`,
    '',
    `narrativeProse:\n${storyDraft.narrativeProse}`,
    '',
    `scenarioSummary: ${storyDraft.scenarioSummary}`,
  ].join('\n');
}

function buildStoryComprehensionPrompt(text: string): string {
  return `다음은 11~15초 숏폼용 3a단계 이야기 초안이다.

${text}

질문: 이 텍스트만 읽고 **일반 시청자**가 setup→펀치·반전을 "아, 그래서 웃기/놀랍구나"로 즉시 이해할 수 있는가?

unclear (하나라도 해당):
- "그래서 뭐?" — 발견·반전·말장난 연결이 빠짐
- 펀치에 필요한 사건(알림·결제·오해 해소 등)이 서술에 없음
- 연운·운세 setup 문구가 모호하거나 반응만 있고 읽은 내용이 없음

clear:
- setup→발견→펀치가 narrativeProse·대사 내용만으로 연결됨

주의:
- 미묘한 반전·말장난도 **대략** 이해되면 clear.
- 애매하면 unclear보다 **clear**를 선택한다.

clear 또는 unclear 중 하나만 답하라.`;
}

export function parseComprehensionVerdict(raw: string | null | undefined): StoryComprehensionVerdict {
  if (!raw?.trim()) return 'unclear';
  const word = raw.trim().toLowerCase().split(/\s+/)[0]?.replace(/[^a-z]/g, '') ?? '';
  if (word === 'clear') return 'clear';
  return 'unclear';
}

export async function assessStoryDraftComprehension(
  storyDraft: StoryDraft,
  punchlineIdea: string,
): Promise<StoryComprehensionVerdict> {
  const model = (await getSubClaudeModel()) || HAIKU_FALLBACK;
  const prompt = buildStoryComprehensionPrompt(formatStoryDraftForComprehension(storyDraft, punchlineIdea));

  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await askClaudeWithModel({
      model,
      max_tokens: 32,
      prompt,
      timeout_ms: 45_000,
    });
    if (raw?.trim()) return parseComprehensionVerdict(raw);
  }

  // API 일시 오류·빈 응답 — 생성 전체를 막지 않음
  return 'clear';
}

export function buildStoryClarityRegenPrompt(params: {
  existing: StoryDraft;
  punchlineIdea: string;
  feedback: string;
  workspace?: string;
}): string {
  const { existing, punchlineIdea, feedback } = params;
  return `3a단계 storyDraft **부분 수정** — 펀치라인 결말·인물·장소 골격은 유지, 이해·전달만 강화.

펀치라인(결말 고정 — 변경 금지):
${punchlineIdea}

현재 storyDraft:
${JSON.stringify(existing, null, 2)}

⚠️ 보완 요청:
${feedback}

수정 범위:
- narrativeProse·scenarioSummary·대사 **내용** 보완 (setup→발견→펀치 순서 명확히)
- characters·location·lighting 등 메타는 유지 가능 (필요 시 location만 미세 조정)
- 샷 개수·camera/action JSON 금지

JSON만 출력 (storyDraft 스키마 동일).`;
}

export async function regenerateStoryDraftForClarity(params: {
  existing: StoryDraft;
  punchlineIdea: string;
  feedback: string;
  model: string;
}): Promise<StoryDraft> {
  const { parsed } = await callClaudeJsonWithRetry<Record<string, unknown>>({
    model: params.model,
    max_tokens: STORY_DRAFT_MAX_TOKENS,
    prompt: buildStoryClarityRegenPrompt({
      existing: params.existing,
      punchlineIdea: params.punchlineIdea,
      feedback: params.feedback,
    }),
    ask: (p) => askClaudeWithModel({ ...p, timeout_ms: 120_000 }),
    maxAttempts: 4,
  });
  return parseStoryDraft(parsed);
}
