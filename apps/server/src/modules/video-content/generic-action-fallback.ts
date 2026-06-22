import { normalizeDialogueBody } from './dialogue-timing.js';
import {
  GENERIC_DEFAULT_ACTION_PHRASES,
  SHOT_CONTENT_MIN_CHARS,
  isGenericDefaultAction,
} from './conti-validation.js';
import type { StoryDraft } from './story-draft.js';
import type { VideoConti, VideoContiShot } from './types.js';
import { asContiShots } from './types.js';

export const GENERIC_ACTION_NARRATIVE_FALLBACK_WARNING =
  'filler action — 3a narrative·대사에서 action 자동 보완 (EvoLink 품질 검토 권장)';

function splitNarrativeSentences(text: string): string[] {
  return text
    .trim()
    .split(/(?<=[.!?…])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 8);
}

/** 3a narrative·대사에서 구체 action 합성 — filler 대체용 */
export function synthesizeConcreteShotAction(params: {
  shotIndex: number;
  shotCount: number;
  narrativeProse?: string;
  scenarioSummary?: string;
  dialogue?: string;
}): string {
  const source = params.narrativeProse?.trim() || params.scenarioSummary?.trim() || '';
  const sentences = splitNarrativeSentences(source);
  const shotCount = Math.max(1, params.shotCount);

  if (sentences.length > 0) {
    const pick = Math.min(
      Math.floor((params.shotIndex / shotCount) * sentences.length),
      sentences.length - 1,
    );
    let action = sentences[pick]!
      .replace(/^[「『"\s]+/, '')
      .replace(/[」』"\s]+$/, '')
      .trim();
    if (action.length < SHOT_CONTENT_MIN_CHARS && pick + 1 < sentences.length) {
      action = `${action} ${sentences[pick + 1]!.trim()}`.trim();
    }
    if (action.length >= SHOT_CONTENT_MIN_CHARS && !isGenericDefaultAction(action)) {
      return action;
    }
  }

  const dlg = normalizeDialogueBody(params.dialogue ?? '');
  if (dlg.length >= 4) {
    const line = dlg.length > 48 ? `${dlg.slice(0, 48)}…` : dlg;
    return `A가 "${line}"라고 말하며 표정과 손짓으로 상황에 맞게 반응한다.`;
  }

  if (source.length >= SHOT_CONTENT_MIN_CHARS) {
    const chunkLen = Math.max(SHOT_CONTENT_MIN_CHARS, Math.ceil(source.length / shotCount));
    const start = Math.min(params.shotIndex * chunkLen, Math.max(0, source.length - chunkLen));
    const chunk = source.slice(start, start + chunkLen).trim();
    if (chunk.length >= SHOT_CONTENT_MIN_CHARS && !isGenericDefaultAction(chunk)) {
      return chunk;
    }
  }

  return `A가 ${params.shotIndex + 1}번째 순간의 표정과 동작으로 장면을 이어간다.`;
}

export function applyGenericActionNarrativeFallback(
  conti: VideoConti,
  ctx: { storyDraft?: StoryDraft; scenarioSummary?: string },
): { conti: VideoConti; replacedShotNumbers: number[] } {
  const shots = asContiShots(conti.shots);
  const narrativeProse = ctx.storyDraft?.narrativeProse;
  const scenarioSummary = ctx.scenarioSummary ?? conti.scenarioSummary;
  const replaced: number[] = [];

  const newShots = shots.map((shot, i) => {
    if (!isGenericDefaultAction(shot.action)) return shot;
    const synthesized = synthesizeConcreteShotAction({
      shotIndex: i,
      shotCount: shots.length,
      narrativeProse,
      scenarioSummary,
      dialogue: shot.dialogue,
    });
    if (isGenericDefaultAction(synthesized)) return shot;
    replaced.push(shot.shotNumber ?? i + 1);
    return { ...shot, action: synthesized };
  });

  return { conti: { ...conti, shots: newShots }, replacedShotNumbers: replaced };
}

export function findGenericActionShotNumbers(conti: VideoConti): number[] {
  const nums: number[] = [];
  asContiShots(conti.shots).forEach((shot, i) => {
    if (isGenericDefaultAction(shot.action)) nums.push(shot.shotNumber ?? i + 1);
  });
  return nums;
}

export function narrativeHintForShots(
  narrativeProse: string | undefined,
  shotNumbers: number[],
  shotCount: number,
): string {
  if (!narrativeProse?.trim() || !shotNumbers.length) return '';
  const lines = shotNumbers.map((n) => {
    const idx = n - 1;
    const excerpt = synthesizeConcreteShotAction({
      shotIndex: idx,
      shotCount,
      narrativeProse,
    });
    return `샷 ${n} 참고: ${excerpt.slice(0, 120)}`;
  });
  return `\n3a narrative 구간 참고:\n${lines.join('\n')}`;
}

/** patch LLM이 filler를 그대로 반환했는지 */
export function isUsableActionPatch(
  patch: Pick<VideoContiShot, 'action'> | undefined,
  previous: string | undefined,
): boolean {
  const next = patch?.action?.trim();
  if (!next || next.length < SHOT_CONTENT_MIN_CHARS) return false;
  if (isGenericDefaultAction(next)) return false;
  if (previous && next === previous.trim() && isGenericDefaultAction(previous)) return false;
  return !GENERIC_DEFAULT_ACTION_PHRASES.some((p) => next === p);
}
