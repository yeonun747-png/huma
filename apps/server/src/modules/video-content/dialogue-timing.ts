import type { VideoContiShot } from './types.js';

/** 한국어 발화 — 글자 수 ÷ 샷 시간(초)이 이 값을 초과하면 대사 과다 */
export const DIALOGUE_MAX_CHARS_PER_SEC = 5;

function trimField(text: string | undefined | null): string {
  return (text ?? '').trim();
}

function shotDurationSec(shot: VideoContiShot): number {
  const d = shot.endSec - shot.startSec;
  return d > 0 ? d : 0;
}

export function countDialogueQuotedChars(dialogue: string): number {
  const trimmed = trimField(dialogue);
  if (!trimmed) return 0;

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

export function dialogueCharsPerSec(dialogue: string, durationSec: number): number {
  if (durationSec <= 0) return Infinity;
  return countDialogueQuotedChars(dialogue) / durationSec;
}

export function maxDialogueCharsForDuration(durationSec: number): number {
  if (durationSec <= 0) return 0;
  return Math.floor(durationSec * DIALOGUE_MAX_CHARS_PER_SEC);
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
  const chars = countDialogueQuotedChars(dialogue);
  if (chars === 0) return floorSec;
  const needed = Math.ceil((chars / DIALOGUE_MAX_CHARS_PER_SEC) * 2) / 2;
  return Math.max(floorSec, needed);
}

export function buildDialogueLengthRule(): string {
  return (
    `각 샷 dialogue는 해당 샷 시간(초)에 맞게 글자 수를 제한한다. ` +
    `인용부호 안 본문 기준 글자 수÷샷 시간이 ${DIALOGUE_MAX_CHARS_PER_SEC}를 넘으면 안 된다 ` +
    `(2.5초 샷 최대 ${maxDialogueCharsForDuration(2.5)}자, 3초 샷 최대 ${maxDialogueCharsForDuration(3)}자). ` +
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
  const charCount = countDialogueQuotedChars(dialogue);
  if (charCount === 0) return null;
  if (dialogueCharsPerSec(dialogue, duration) <= DIALOGUE_MAX_CHARS_PER_SEC) return null;

  return {
    index: shotIndex,
    kind: 'dialogue_too_long',
    feedback: buildDialogueTooLongFeedback(shotIndex + 1, duration, charCount),
  };
}
