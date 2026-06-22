import type { VideoConti, VideoContiShot } from './types.js';
import { asContiShots } from './types.js';
import { parseDialogueSegments, type DialogueSegment } from './subtitle.js';

/** 한국어 발화 — 글자 수 ÷ 샷 시간(초)이 이 값을 초과하면 대사 과다 */
export const DIALOGUE_MAX_CHARS_PER_SEC = 5;

function trimField(text: string | undefined | null): string {
  return (text ?? '').trim();
}

function shotDurationSec(shot: VideoContiShot): number {
  const d = shot.endSec - shot.startSec;
  return d > 0 ? d : 0;
}

function countNoSpaceChars(text: string): number {
  return text.replace(/\s/g, '').length;
}

/** A:/B: 복수 구간 포함 — 발화 본문 글자 수 */
export function countDialogueSpokenChars(dialogue: string): number {
  const segments = parseDialogueSegments(dialogue);
  if (segments.length) {
    return segments.reduce((sum, seg) => sum + countNoSpaceChars(seg.text), 0);
  }
  return countDialogueQuotedChars(dialogue);
}

export function countDialogueQuotedChars(dialogue: string): number {
  const trimmed = trimField(dialogue);
  if (!trimmed) return 0;

  const spoken = countDialogueSpokenChars(trimmed);
  if (spoken > 0) return spoken;

  const afterLabel = trimmed.replace(/^[AB]:\s*/i, '');
  const openIdx = afterLabel.search(/["「『]/);
  if (openIdx >= 0) {
    const openChar = afterLabel[openIdx]!;
    const closeChar =
      openChar === '「' ? '」' : openChar === '『' ? '』' : openChar === "'" ? "'" : '"';
    const start = openIdx + 1;
    const closeIdx = afterLabel.lastIndexOf(closeChar);
    if (closeIdx > start) {
      return afterLabel.slice(start, closeIdx).replace(/\s/g, '').length;
    }
  }

  return afterLabel.replace(/^["'「]|["'」]$/g, '').replace(/\s/g, '').length;
}

/** dialogue — A/B 라벨·인용부호 제거 본문 (비교·유사도용) */
export function normalizeDialogueBody(dialogue: string): string {
  return trimField(dialogue)
    .replace(/^[AB]:\s*/i, '')
    .replace(/^["「『]|["」』]$/g, '')
    .trim();
}

export function extractDialogueSpeaker(dialogue: string): 'A' | 'B' | null {
  const m = trimField(dialogue).match(/^([AB]):\s*/i);
  if (!m) return null;
  return m[1]!.toUpperCase() as 'A' | 'B';
}

export function dialogueCharsPerSec(dialogue: string, durationSec: number): number {
  if (durationSec <= 0) return Infinity;
  return countDialogueSpokenChars(dialogue) / durationSec;
}

export function maxDialogueCharsForDuration(durationSec: number): number {
  if (durationSec <= 0) return 0;
  return Math.floor(durationSec * DIALOGUE_MAX_CHARS_PER_SEC);
}

export function totalDialogueBudgetForVideo(durationSec: number): number {
  return maxDialogueCharsForDuration(durationSec);
}

export function isDialogueTooLongForShot(shot: VideoContiShot): boolean {
  const dialogue = trimField(shot.dialogue);
  if (!dialogue) return false;
  const duration = shotDurationSec(shot);
  if (duration <= 0) return false;
  return dialogueCharsPerSec(dialogue, duration) > DIALOGUE_MAX_CHARS_PER_SEC;
}

/** chars/duration ≤ 5 를 만족하는 최소 샷 길이(0.5초 단위 올림) */
export function minShotDurationForDialogue(dialogue: string, floorSec = 0): number {
  const chars = countDialogueSpokenChars(dialogue);
  if (chars === 0) return floorSec;
  const needed = Math.ceil((chars / DIALOGUE_MAX_CHARS_PER_SEC) * 2) / 2;
  return Math.max(floorSec, needed);
}

function trimTextToCharCount(text: string, maxNoSpace: number): string {
  if (maxNoSpace <= 0) return '…';
  let count = 0;
  let out = '';
  for (const ch of text) {
    if (!/\s/u.test(ch)) {
      if (count >= maxNoSpace) return `${out}…`;
      count++;
    }
    out += ch;
  }
  return out;
}

function formatDialogueSegments(segments: DialogueSegment[]): string {
  return segments
    .filter((s) => s.text.trim())
    .map((s) => `${s.speaker ?? 'A'}: "${s.text}"`)
    .join(' ');
}

function punchlineSegmentIndex(segments: DialogueSegment[]): number {
  for (let i = segments.length - 1; i >= 0; i--) {
    if (segments[i]!.speaker === 'B') return i;
  }
  return segments.length - 1;
}

function trimSegmentsToBudget(segments: DialogueSegment[], maxChars: number): DialogueSegment[] {
  if (maxChars <= 0) return segments.map((s) => ({ ...s, text: '…' }));
  const total = segments.reduce((sum, seg) => sum + countNoSpaceChars(seg.text), 0);
  if (total <= maxChars) return segments;

  const result = segments.map((seg) => ({ ...seg }));
  const punchIdx = punchlineSegmentIndex(result);
  const punchWant = countNoSpaceChars(result[punchIdx]!.text);
  const punchAlloc = Math.min(
    punchWant,
    Math.max(Math.ceil(maxChars * 0.5), Math.min(punchWant, maxChars - Math.max(0, result.length - 1) * 3)),
  );
  let frontBudget = maxChars - punchAlloc;

  for (let i = 0; i < result.length; i++) {
    if (i === punchIdx) continue;
    const want = countNoSpaceChars(result[i]!.text);
    const othersLeft = result.length - 1 - i;
    const alloc =
      othersLeft > 0
        ? Math.min(want, Math.max(2, Math.floor(frontBudget / othersLeft)))
        : Math.min(want, frontBudget);
    result[i]!.text = trimTextToCharCount(result[i]!.text, alloc);
    frontBudget -= countNoSpaceChars(result[i]!.text);
  }

  const punchBudget = Math.max(
    4,
    maxChars - result.reduce((s, seg, i) => (i === punchIdx ? s : s + countNoSpaceChars(seg.text)), 0),
  );
  result[punchIdx]!.text = trimTextToCharCount(result[punchIdx]!.text, punchBudget);
  return result;
}

/** 샷 시간에 맞게 대사 축소 — 마지막 A/B 구간(펀치) 우선 보존 */
export function trimDialogueToFitShot(dialogue: string, durationSec: number): string {
  let maxChars = maxDialogueCharsForDuration(durationSec);
  const segments = parseDialogueSegments(dialogue);
  let result: string;
  if (!segments.length) {
    if (countDialogueSpokenChars(dialogue) <= maxChars) return dialogue;
    const m = dialogue.match(/^([AB]:\s*)?/i);
    const prefix = m?.[0] ?? '';
    const body = dialogue.slice(prefix.length).replace(/^["'「]|["'」]$/g, '');
    result = `${prefix}"${trimTextToCharCount(body, maxChars)}"`;
  } else {
    result = formatDialogueSegments(trimSegmentsToBudget(segments, maxChars));
  }
  while (countDialogueSpokenChars(result) > maxChars && maxChars > 4) {
    maxChars -= 2;
    if (segments.length) {
      result = formatDialogueSegments(trimSegmentsToBudget(segments, maxChars));
    } else {
      const m = result.match(/^([AB]:\s*)?/i);
      const prefix = m?.[0] ?? '';
      const body = result.slice(prefix.length).replace(/^["'「]|["'」]$/g, '');
      result = `${prefix}"${trimTextToCharCount(body, maxChars)}"`;
    }
  }
  return result;
}

export function buildDialogueLengthRule(): string {
  return (
    `각 샷 dialogue는 해당 샷 시간(초)에 맞게 글자 수를 제한한다. ` +
    `인용부호 안 본문 기준 글자 수÷샷 시간이 ${DIALOGUE_MAX_CHARS_PER_SEC}를 넘으면 안 된다 ` +
    `(2.5초 샷 최대 ${maxDialogueCharsForDuration(2.5)}자, 3초 샷 최대 ${maxDialogueCharsForDuration(3)}자, 7.5초 샷 최대 ${maxDialogueCharsForDuration(7.5)}자). ` +
    `영상 전체 대사 합도 duration×${DIALOGUE_MAX_CHARS_PER_SEC}자를 넘지 말 것(12초→${totalDialogueBudgetForVideo(12)}자). ` +
    '한 샷에 A·B 대사를 여러 줄 넣지 말고 샷을 나누거나 문장을 압축한다. ' +
    '동작·표정 연기가 많은 샷은 더 짧게 쓴다. 긴 문장은 두 샷으로 나누거나 문장을 압축한다. ' +
    '시간 안에 다 들어가지 않을 것 같으면 대사를 줄이는 것을 우선한다(행동 묘사는 유지).'
  );
}

export function buildDialogueTooLongFeedback(
  shotNumber: number,
  durationSec: number,
  charCount: number,
): string {
  return (
    `샷 ${shotNumber}의 대사가 ${durationSec}초 안에 발화하기엔 너무 길다(현재 ${charCount}자). ` +
    '같은 의미를 더 짧고 압축적인 문장으로 줄이거나, 일부 내용을 다음 샷으로 넘겨서 다시 작성하라.'
  );
}

export function findDialogueTooLongIssue(
  shot: VideoContiShot,
  shotIndex: number,
): { index: number; kind: 'dialogue_too_long'; feedback: string } | null {
  const dialogue = trimField(shot.dialogue);
  if (!dialogue) return null;
  const duration = shotDurationSec(shot);
  if (duration <= 0) return null;
  const charCount = countDialogueSpokenChars(dialogue);
  if (charCount === 0) return null;
  if (dialogueCharsPerSec(dialogue, duration) <= DIALOGUE_MAX_CHARS_PER_SEC) return null;

  return {
    index: shotIndex,
    kind: 'dialogue_too_long',
    feedback: buildDialogueTooLongFeedback(shotIndex + 1, duration, charCount),
  };
}

/** 샷별·전체 러닝타임 대사량 강제 조정 */
export function enforceDialogueOnConti(conti: VideoConti): {
  conti: VideoConti;
  adjusted: boolean;
  warnings: string[];
} {
  const warnings: string[] = [];
  let adjusted = false;
  const totalBudget = totalDialogueBudgetForVideo(conti.duration);

  let shots = asContiShots(conti.shots).map((shot) => {
    const dialogue = trimField(shot.dialogue);
    if (!dialogue) return shot;
    const duration = shotDurationSec(shot);
    const max = maxDialogueCharsForDuration(duration);
    const chars = countDialogueSpokenChars(dialogue);
    if (chars <= max) return shot;
    adjusted = true;
    warnings.push(`샷 ${shot.shotNumber}: 대사 ${chars}자→${max}자 이내로 자동 축소`);
    return { ...shot, dialogue: trimDialogueToFitShot(dialogue, duration) };
  });

  let totalChars = shots.reduce(
    (sum, shot) => sum + (shot.dialogue ? countDialogueSpokenChars(shot.dialogue) : 0),
    0,
  );

  if (totalChars > totalBudget && shots.length) {
    const lastIdx = shots.length - 1;
    for (let i = 0; i < shots.length && totalChars > totalBudget; i++) {
      if (i === lastIdx) continue;
      const shot = shots[i]!;
      const dialogue = trimField(shot.dialogue);
      if (!dialogue) continue;
      const duration = shotDurationSec(shot);
      const current = countDialogueSpokenChars(dialogue);
      const over = totalChars - totalBudget;
      const nextMax = Math.max(3, current - over);
      const trimmed = trimDialogueToFitShot(dialogue, nextMax / DIALOGUE_MAX_CHARS_PER_SEC);
      if (trimmed !== dialogue) {
        shots[i] = { ...shot, dialogue: trimmed };
        adjusted = true;
        warnings.push(`샷 ${shot.shotNumber}: 영상 전체 대사 예산(${totalBudget}자) 초과 — 추가 축소`);
        totalChars = shots.reduce(
          (sum, s) => sum + (s.dialogue ? countDialogueSpokenChars(s.dialogue) : 0),
          0,
        );
      }
    }
  }

  return { conti: { ...conti, shots }, adjusted, warnings };
}
