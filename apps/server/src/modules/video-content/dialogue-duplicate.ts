import type { VideoConti, VideoContiShot } from './types.js';
import { normalizeDialogueBody } from './dialogue-timing.js';

/** 전 샷 대사 본문 유사도 — ADJACENT_SHOT_SIMILARITY_THRESHOLD 와 동일 */
export const DIALOGUE_DUPLICATE_SIMILARITY_THRESHOLD = 0.9;

function trimField(text: string | undefined | null): string {
  return (text ?? '').trim();
}

function normalizeCompareText(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLowerCase();
}

function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const row = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    let prev = row[0]!;
    row[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = row[j]!;
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j - 1]! + 1, row[j]! + 1, prev + cost);
      prev = tmp;
    }
  }
  return row[n]!;
}

function dialogueBodySimilarity(a: string, b: string): number {
  const na = normalizeCompareText(a);
  const nb = normalizeCompareText(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const longer = na.length >= nb.length ? na : nb;
  const shorter = na.length >= nb.length ? nb : na;
  const dist = levenshteinDistance(longer, shorter);
  return 1 - dist / longer.length;
}

export function dialoguesTooSimilar(a: string | undefined | null, b: string | undefined | null): boolean {
  const bodyA = normalizeDialogueBody(trimField(a ?? ''));
  const bodyB = normalizeDialogueBody(trimField(b ?? ''));
  if (!bodyA || !bodyB) return false;
  if (bodyA === bodyB) return true;
  return dialogueBodySimilarity(bodyA, bodyB) >= DIALOGUE_DUPLICATE_SIMILARITY_THRESHOLD;
}

/** 펀치라인 대사가 있을 가능성이 높은 샷 — 마지막 또는 마지막 직전 */
export function findPunchlineShotIndexForDialogue(shots: VideoContiShot[]): number {
  if (!shots.length) return -1;
  const last = shots.length - 1;
  const prev = last - 1;
  if (shots[last]?.dialogue?.trim()) return last;
  if (prev >= 0 && shots[prev]?.dialogue?.trim()) return prev;
  return last;
}

export function buildDialogueDistinctRule(): string {
  return (
    '전 샷 dialogue 본문이 서로 동일하거나 거의 같으면 안 된다(화자 A/B만 바꾼 재탕 금지). ' +
    '특히 펀치라인(마지막 1~2샷) 대사는 이전 샷 대사를 그대로 반복하지 말고, ' +
    '우연·반전을 알게 된 뒤의 새로운 반응이나 한 단계 더 나간 대사로 작성한다.'
  );
}

export function buildDialogueDuplicateFeedback(shotNumber: number, priorShotNumber: number): string {
  return (
    `샷 ${shotNumber}의 대사가 샷 ${priorShotNumber}의 대사와 동일하거나 매우 유사하다. ` +
    '같은 말을 반복하는 게 아니라, 그 우연의 일치 자체에 대한 새로운 반응이나 한 단계 더 나간 대사로 다시 작성하라. ' +
    "예: 단순 반복이 아니라 '와, 진짜 그럼...' 식으로 그 사실을 알게 된 후의 반응을 담아야 한다."
  );
}

export interface DialogueDuplicateIssue {
  index: number;
  priorIndex: number;
  feedback: string;
}

/** 펀치라인 샷이 이전 샷 대사를 재사용하면 펀치라인 샷 패치 대상 */
export function findDialogueDuplicateIssue(conti: VideoConti): DialogueDuplicateIssue | null {
  const shots = conti.shots;
  if (shots.length < 2) return null;

  const punchlineIdx = findPunchlineShotIndexForDialogue(shots);

  if (punchlineIdx >= 0) {
    const punchlineDialogue = trimField(shots[punchlineIdx]!.dialogue);
    if (punchlineDialogue) {
      for (let i = 0; i < punchlineIdx; i++) {
        const earlier = trimField(shots[i]!.dialogue);
        if (!earlier) continue;
        if (dialoguesTooSimilar(earlier, punchlineDialogue)) {
          return {
            index: punchlineIdx,
            priorIndex: i,
            feedback: buildDialogueDuplicateFeedback(punchlineIdx + 1, i + 1),
          };
        }
      }
    }
  }

  for (let j = 1; j < shots.length; j++) {
    const dialogueJ = trimField(shots[j]!.dialogue);
    if (!dialogueJ) continue;

    for (let i = 0; i < j; i++) {
      const dialogueI = trimField(shots[i]!.dialogue);
      if (!dialogueI) continue;
      if (!dialoguesTooSimilar(dialogueI, dialogueJ)) continue;

      return {
        index: j,
        priorIndex: i,
        feedback: buildDialogueDuplicateFeedback(j + 1, i + 1),
      };
    }
  }

  return null;
}

export function hasDialogueDuplicate(conti: VideoConti): boolean {
  return findDialogueDuplicateIssue(conti) != null;
}
