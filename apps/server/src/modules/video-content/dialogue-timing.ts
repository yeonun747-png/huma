import type { VideoConti, VideoContiShot } from './types.js';
import { asContiShots } from './types.js';
import { parseDialogueSegments, type DialogueSegment } from './subtitle.js';

/** 검증·프롬프트 — 권장 상한 (한국어 숏폼 발화) */
export const DIALOGUE_MAX_CHARS_PER_SEC = 8;

/** 렌더 직전 자동 축소 — 검증보다 여유 있게, 심각한 초과만 기계 축소 */
export const DIALOGUE_TRIM_CHARS_PER_SEC = 10;

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

export function maxDialogueTrimCharsForDuration(durationSec: number): number {
  if (durationSec <= 0) return 0;
  return Math.floor(durationSec * DIALOGUE_TRIM_CHARS_PER_SEC);
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

/** chars/duration ≤ DIALOGUE_MAX_CHARS_PER_SEC 를 만족하는 최소 샷 길이(0.5초 단위 올림) */
export function minShotDurationForDialogue(dialogue: string, floorSec = 0): number {
  const chars = countDialogueSpokenChars(dialogue);
  if (chars === 0) return floorSec;
  const needed = Math.ceil((chars / DIALOGUE_MAX_CHARS_PER_SEC) * 2) / 2;
  return Math.max(floorSec, needed);
}

function trimTextToCharCount(text: string, maxNoSpace: number): string {
  if (maxNoSpace <= 0) return '…';
  if (countNoSpaceChars(text) <= maxNoSpace) return text;

  const sentences = text.split(/(?<=[.?!…])\s*/u).filter((s) => s.trim());
  if (sentences.length > 1) {
    let kept = '';
    for (const sent of sentences) {
      const candidate = kept ? `${kept} ${sent}` : sent;
      if (countNoSpaceChars(candidate) <= maxNoSpace) kept = candidate;
      else break;
    }
    if (kept && countNoSpaceChars(kept) >= Math.min(8, Math.floor(maxNoSpace * 0.55))) return kept;
  }

  const clauses = text.split(/(?<=[,，])\s*/u).filter((s) => s.trim());
  if (clauses.length > 1) {
    let kept = '';
    for (const clause of clauses) {
      const candidate = kept ? `${kept} ${clause}` : clause;
      if (countNoSpaceChars(candidate) <= maxNoSpace) kept = candidate;
      else break;
    }
    if (kept && countNoSpaceChars(kept) >= Math.min(6, Math.floor(maxNoSpace * 0.5))) return kept;
  }

  let count = 0;
  let out = '';
  for (const ch of text) {
    if (!/\s/u.test(ch)) {
      if (count >= maxNoSpace) {
        const trimmed = out.replace(/\s+$/u, '');
        if (trimmed.length >= 4) return `${trimmed}…`;
        return '…';
      }
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
  const minPerOther = Math.min(8, Math.max(5, Math.floor(maxChars * 0.12)));
  const punchAlloc = Math.min(
    punchWant,
    Math.max(
      Math.ceil(maxChars * 0.45),
      Math.min(punchWant, maxChars - Math.max(0, result.length - 1) * minPerOther),
    ),
  );
  let frontBudget = maxChars - punchAlloc;

  for (let i = 0; i < result.length; i++) {
    if (i === punchIdx) continue;
    const want = countNoSpaceChars(result[i]!.text);
    const othersLeft = result.length - 1 - i;
    const alloc =
      othersLeft > 0
        ? Math.min(want, Math.max(minPerOther, Math.floor(frontBudget / othersLeft)))
        : Math.min(want, frontBudget);
    result[i]!.text = trimTextToCharCount(result[i]!.text, alloc);
    frontBudget -= countNoSpaceChars(result[i]!.text);
  }

  const punchBudget = Math.max(
    10,
    maxChars - result.reduce((s, seg, i) => (i === punchIdx ? s : s + countNoSpaceChars(seg.text)), 0),
  );
  result[punchIdx]!.text = trimTextToCharCount(result[punchIdx]!.text, punchBudget);
  return result;
}

/** 샷 시간에 맞게 대사 축소 — 마지막 A/B 구간(펀치) 우선 보존 */
export function trimDialogueToFitShot(
  dialogue: string,
  durationSec: number,
  charsPerSec = DIALOGUE_TRIM_CHARS_PER_SEC,
): string {
  let maxChars = Math.floor(durationSec * charsPerSec);
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
    `각 샷 dialogue는 scenarioSummary 없이도 그 샷의 사건·정보가 전달되게 완결된 짧은 문장으로 쓴다. ` +
    `인용부호 안 본문 기준 글자 수÷샷 시간이 ${DIALOGUE_MAX_CHARS_PER_SEC}를 넘으면 안 된다 ` +
    `(1.5초 샷 최대 ${maxDialogueCharsForDuration(1.5)}자, 3초 샷 최대 ${maxDialogueCharsForDuration(3)}자, 5초 샷 최대 ${maxDialogueCharsForDuration(5)}자). ` +
    '단어만 남기거나 "…"로 끊긴 불완전 대사 금지. setup·연운 경고·반전은 대사에 핵심 정보를 넣는다. ' +
    '한 샷에 A·B 대사를 여러 줄 넣지 말고 샷을 나누거나 문장을 압축한다. ' +
    '동작·표정 연기가 많은 샷은 더 짧게 쓸 수 있으나, 말이 필요한 샷은 의미가 통하는 최소 길이를 유지한다.'
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

/** 렌더 직전 — 심각한 초과만 기계 축소 (콘티 검토 화면은 LLM 원문 유지) */
export function enforceDialogueOnConti(conti: VideoConti): {
  conti: VideoConti;
  adjusted: boolean;
  warnings: string[];
} {
  const warnings: string[] = [];
  let adjusted = false;

  const shots = asContiShots(conti.shots).map((shot) => {
    const dialogue = trimField(shot.dialogue);
    if (!dialogue) return shot;
    const duration = shotDurationSec(shot);
    const trimMax = maxDialogueTrimCharsForDuration(duration);
    const chars = countDialogueSpokenChars(dialogue);
    if (chars <= trimMax) return shot;
    adjusted = true;
    warnings.push(
      `샷 ${shot.shotNumber}: 대사 ${chars}자→${trimMax}자 이내로 렌더 전 축소 (${DIALOGUE_TRIM_CHARS_PER_SEC}자/초)`,
    );
    return { ...shot, dialogue: trimDialogueToFitShot(dialogue, duration) };
  });

  return { conti: { ...conti, shots }, adjusted, warnings };
}
