import type { VideoConti, VideoContiShot } from './types.js';

export class ContiValidationError extends Error {
  readonly maxAttempts: number;
  readonly holdOnFailure: boolean;
  readonly holdReason?: 'shot_duration' | 'empty_content';

  constructor(
    message: string,
    options?: {
      maxAttempts?: number;
      holdOnFailure?: boolean;
      holdReason?: 'shot_duration' | 'empty_content';
    },
  ) {
    super(message);
    this.name = 'ContiValidationError';
    this.maxAttempts = options?.maxAttempts ?? DEFAULT_CONTI_VALIDATION_MAX_ATTEMPTS;
    this.holdOnFailure = options?.holdOnFailure ?? false;
    this.holdReason = options?.holdReason;
  }
}

export const DEFAULT_CONTI_VALIDATION_MAX_ATTEMPTS = 3;
export const MAX_SHOT_DURATION_REGENERATION_ATTEMPTS = 2;
export const MAX_EMPTY_CONTENT_REGENERATION_ATTEMPTS = 1;
export const SHOT_MIN_DURATION_SEC = 1.5;
export const SHOT_CONTENT_MIN_CHARS = 10;
export const ADJACENT_SHOT_SIMILARITY_THRESHOLD = 0.9;
export const MAX_ADJACENT_DUPLICATE_PATCH_ATTEMPTS = 1;
export const MAX_SHOT_QUALITY_PATCH_ATTEMPTS = 1;

/** 1단계: 시나리오·인물·장소 / 2단계: 샷·대사 / 보완: 빈 샷만 */
export const CONTI_FOUNDATION_MAX_TOKENS = 4096;
export const CONTI_SHOTS_MAX_TOKENS = 4096;
export const CONTI_SHOT_FILL_MAX_TOKENS = 2048;

/** @deprecated 2단계 분리 전 단일 호출용 — 신규 코드는 FOUNDATION+SHOTS 사용 */
export const CONTI_GENERATION_MAX_TOKENS = 8192;

/** 자리표시자 — 정확 일치(대소문자 무시) 시 무효 */
export const SHOT_CONTENT_PLACEHOLDERS = [
  '장면 전개',
  '내용 추가 필요',
  '내용 없음',
  '내용 미정',
  'TBD',
  'TODO',
  'N/A',
  '미정',
  '추후 작성',
] as const;

export const SINGLE_SHOT_CUT_MISMATCH_FEEDBACK =
  'single_shot은 컷 전환이 전혀 없는 한 화면 구성이어야 한다. 현재 결과는 여러 컷으로 나뉘어 있어 single_shot 정의에 맞지 않는다, 컷을 하나로 통합해서 다시 작성하라.';

export const MULTI_SHOT_CUT_MISMATCH_FEEDBACK =
  'multi_shot은 여러 컷(샷)으로 나뉜 구성이어야 한다. 현재 샷이 1개만 생성되어 multi_shot 정의에 맞지 않는다, 최소 2개 이상의 샷으로 다시 작성하라.';

export const PUNCHLINE_MIN_DURATION_SEC = 2;

function shotDurationSec(shot: VideoContiShot): number {
  const d = shot.endSec - shot.startSec;
  return d > 0 ? d : 0;
}

export function buildShotTooShortFeedback(shotNumber: number, durationSec: number): string {
  return (
    `샷 ${shotNumber}의 길이가 너무 짧다(${durationSec}초, 0초 또는 1초 미만), ` +
    `전체 샷 개수를 줄이거나 시간 배분을 재조정해서 모든 샷이 최소 ${SHOT_MIN_DURATION_SEC}초 이상이 되도록 다시 작성하라.`
  );
}

/** 모든 샷 최소 길이 — normalize·펀치라인 보정 이후 검사 */
export function validateAllShotsMinDuration(
  conti: VideoConti,
  minSec = SHOT_MIN_DURATION_SEC,
): { ok: true } | { ok: false; feedback: string } {
  for (let i = 0; i < conti.shots.length; i++) {
    const dur = shotDurationSec(conti.shots[i]!);
    if (dur < minSec) {
      return { ok: false, feedback: buildShotTooShortFeedback(i + 1, dur) };
    }
  }
  return { ok: true };
}

export function buildDurationShotCountGuide(duration: number): string {
  const guides: Record<number, string> = {
    9: '9초 영상: 샷 개수 4~5개 권장 (샷당 평균 약 2초 확보)',
    11: '11초 영상: 샷 개수 4~6개',
    13: '13초 영상: 샷 개수 5~6개',
    15: '15초 영상: 샷 개수 5~6개',
  };
  return guides[duration] ?? `${duration}초 영상: 샷 개수를 줄여 샷당 최소 ${SHOT_MIN_DURATION_SEC}초 이상 확보`;
}

const SHOT_COUNT_LOWER_BOUNDS: Record<number, number> = {
  9: 4,
  11: 4,
  13: 5,
  15: 5,
};

/** 시나리오가 빈약할 때 권장 범위 하한 우선 */
export function buildShotCountPreferLowerGuide(duration: number): string {
  const base = buildDurationShotCountGuide(duration);
  const lower = SHOT_COUNT_LOWER_BOUNDS[duration];
  if (!lower) return base;
  return (
    `${base} 시나리오 내용이 충분히 풍부하지 않으면 권장 범위 하한(${lower}개)을 우선 사용하고, ` +
    '인접 샷 내용 복제로 시간을 채우지 말 것.'
  );
}

export function buildNoDuplicateFillRule(): string {
  return (
    `각 샷은 최소 ${SHOT_MIN_DURATION_SEC}초 이상이어야 하지만, 그 시간을 채우기 위해 다른 샷의 내용을 복제하지 않는다. ` +
    '짧은 샷이라도 직전 샷과 구별되는 새로운 행동, 표정 변화, 또는 카메라 움직임을 담아야 한다. ' +
    '특정 샷에 채울 새로운 내용이 부족하다면, 샷 개수를 줄이고 남은 샷들의 시간을 늘려서 재구성한다.'
  );
}

export function buildAdjacentShotDistinctRule(): string {
  return (
    '연속된 두 샷의 action/dialogue는 완전히 동일하거나 거의 같으면 안 된다. ' +
    '직전 샷과 다른 행동·대사·카메라 앵글로 작성하라.'
  );
}

export function buildMinShotDurationRule(duration: number): string {
  return (
    `모든 개별 샷은 최소 ${SHOT_MIN_DURATION_SEC}초 이상이어야 한다. ` +
    `0초 또는 1초 미만의 샷 금지. ${buildShotCountPreferLowerGuide(duration)}`
  );
}

function trimField(text: string | undefined | null): string {
  return (text ?? '').trim();
}

export function isShotContentPlaceholder(text: string): boolean {
  const t = trimField(text);
  if (!t) return true;
  const lower = t.toLowerCase();
  return SHOT_CONTENT_PLACEHOLDERS.some((p) => t === p || lower === p.toLowerCase());
}

/** 액션 필수. 대사는 비어 있어도 됨(반응 샷), 있으면 동일 기준 적용 */
export function isInvalidShotContentField(text: string | undefined | null): boolean {
  const t = trimField(text);
  if (!t) return true;
  if (t.length < SHOT_CONTENT_MIN_CHARS) return true;
  if (isShotContentPlaceholder(t)) return true;
  return false;
}

export function buildEmptyShotContentFeedback(shotNumber: number): string {
  return (
    `생성된 콘티의 샷 ${shotNumber}에 실제 액션/대사 내용이 없다, ` +
    '모든 샷에 구체적인 카메라 디렉션과 액션/대사를 빠짐없이 작성해서 다시 생성하라.'
  );
}

export function validateShotContent(
  shot: VideoContiShot,
  shotNumber: number,
): { ok: true } | { ok: false; feedback: string } {
  if (isInvalidShotContentField(shot.action)) {
    return { ok: false, feedback: buildEmptyShotContentFeedback(shotNumber) };
  }
  const dialogue = trimField(shot.dialogue);
  if (dialogue && isInvalidShotContentField(dialogue)) {
    return { ok: false, feedback: buildEmptyShotContentFeedback(shotNumber) };
  }
  return { ok: true };
}

/** LLM이 실제 반환한 샷만 검사 — normalize 전 (빈 슬롯 채우기로 인한 오탐 방지) */
export function validateRawShotsContent(
  conti: VideoConti,
): { ok: true } | { ok: false; feedback: string; shotNumber: number } {
  for (let i = 0; i < conti.shots.length; i++) {
    const check = validateShotContent(conti.shots[i]!, i + 1);
    if (!check.ok) return { ok: false, feedback: check.feedback, shotNumber: i + 1 };
  }
  return { ok: true };
}

/** 무효 raw 샷 인덱스 (0-based) */
export function findInvalidRawShotIndices(conti: VideoConti): number[] {
  const invalid: number[] = [];
  for (let i = 0; i < conti.shots.length; i++) {
    const check = validateShotContent(conti.shots[i]!, i + 1);
    if (!check.ok) invalid.push(i);
  }
  return invalid;
}

export function buildShotFillPrompt(shotNumbers: number[]): string {
  return (
    `샷 ${shotNumbers.join(', ')}의 camera/action/dialogue만 작성해서 채워달라. ` +
    '다른 샷은 변경하지 말 것. action은 구체적 카메라·행동 묘사 필수.'
  );
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

/** 0~1 — 1이 완전 동일 */
export function textSimilarity(a: string, b: string): number {
  const na = normalizeCompareText(a);
  const nb = normalizeCompareText(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const longer = na.length >= nb.length ? na : nb;
  const shorter = na.length >= nb.length ? nb : na;
  const dist = levenshteinDistance(longer, shorter);
  return 1 - dist / longer.length;
}

function fieldsTooSimilar(a: string | undefined | null, b: string | undefined | null): boolean {
  const ta = trimField(a);
  const tb = trimField(b);
  if (!ta || !tb) return false;
  if (ta === tb) return true;
  return textSimilarity(ta, tb) >= ADJACENT_SHOT_SIMILARITY_THRESHOLD;
}

function adjacentShotsTooSimilar(prev: VideoContiShot, curr: VideoContiShot): boolean {
  if (fieldsTooSimilar(prev.action, curr.action)) return true;
  if (fieldsTooSimilar(prev.dialogue, curr.dialogue)) return true;
  const combinedPrev = [prev.action, prev.dialogue].map((t) => trimField(t)).filter(Boolean).join(' | ');
  const combinedCurr = [curr.action, curr.dialogue].map((t) => trimField(t)).filter(Boolean).join(' | ');
  if (combinedPrev && combinedCurr && textSimilarity(combinedPrev, combinedCurr) >= ADJACENT_SHOT_SIMILARITY_THRESHOLD) {
    return true;
  }
  return false;
}

export function buildAdjacentDuplicateFeedback(shotNumber: number): string {
  return (
    `샷 ${shotNumber}이 직전 샷과 내용이 동일하다, 다른 행동이나 대사로 새로 작성하라. ` +
    '직전 샷과 구별되는 카메라·행동·표정 변화를 담을 것.'
  );
}

/** 인접 중복 — 후행 샷 인덱스(0-based) 목록 */
export function findAdjacentDuplicateShotIndices(conti: VideoConti): number[] {
  const invalid: number[] = [];
  for (let i = 1; i < conti.shots.length; i++) {
    if (adjacentShotsTooSimilar(conti.shots[i - 1]!, conti.shots[i]!)) {
      invalid.push(i);
    }
  }
  return invalid;
}

/** normalize·펀치라인 보정 이후 — 모든 샷 액션/대사 실질 내용 검사 */
export function validateAllShotsContent(
  conti: VideoConti,
): { ok: true } | { ok: false; feedback: string } {
  for (let i = 0; i < conti.shots.length; i++) {
    const check = validateShotContent(conti.shots[i]!, i + 1);
    if (!check.ok) return check;
  }
  return { ok: true };
}

export function formatContiTokenSettingsLog(): string {
  return (
    `[video-content] 콘티 LLM 설정(2단계 분리) — foundation_max_tokens=${CONTI_FOUNDATION_MAX_TOKENS} ` +
    `shots_max_tokens=${CONTI_SHOTS_MAX_TOKENS} shot_fill_max_tokens=${CONTI_SHOT_FILL_MAX_TOKENS}`
  );
}

export function buildSentenceCompleteRule(): string {
  return (
    '각 샷 action/dialogue는 마침표·느낌표·물음표 또는 자연스러운 한글 종결어미로 끝나는 완결된 문장이어야 한다. ' +
    '단어 중간에서 끊기거나 조사만 남은 채 끝나면 안 된다. camera 라벨과 action 첫 문장의 샷 종류(와이드/미디엄/클로즈업)는 일치해야 한다.'
  );
}

export function buildShotContentRule(): string {
  return (
    `모든 샷 action 필드는 ${SHOT_CONTENT_MIN_CHARS}자 이상의 구체적 카메라·행동 묘사 필수. ` +
    `대사가 있는 샷은 dialogue도 ${SHOT_CONTENT_MIN_CHARS}자 이상. ` +
    `"장면 전개", "내용 없음", "TBD" 등 자리표시자 금지. ` +
    `${buildAdjacentShotDistinctRule()} ${buildSentenceCompleteRule()}`
  );
}

const KOREAN_SENTENCE_ENDING =
  /(?:다|요|죠|네|함|음|군|니|냐|까|자|세|래|겠|습니다|니다|어요|아요|해요|했어|세요|지요|거든|네요|예요|래요|같아|좋아|선다|본다|간다|인다|운다|친다|한다|된다|있다|없다|였다|했다|마친다|끝난다)$/u;

/** 마침표·느낌표·물음표·닫는 인용부호 또는 한글 종결어미 */
export function isSentenceComplete(text: string): boolean {
  const t = trimField(text);
  if (!t) return true;

  let core = t.replace(/[\s"'“”‘’」』\)\]》]+$/gu, '');
  if (!core) return false;

  const last = core.at(-1)!;
  if ('.!?…'.includes(last)) return true;
  if (KOREAN_SENTENCE_ENDING.test(core)) return true;

  return false;
}

/** 조사형 글자로 끝나며 문장부호·종결어미 없음 — "폰으" 등 */
function endsWithSuspiciousIncompleteParticle(text: string): boolean {
  const t = trimField(text);
  if (!t || isSentenceComplete(t)) return false;
  const last = t.at(-1)!;
  return /[을를이가에의와과로면도만은조]$/.test(last);
}

export function isIncompleteSentence(text: string | undefined | null): boolean {
  const t = trimField(text);
  if (!t) return false;
  if (isSentenceComplete(t)) return false;
  if (endsWithSuspiciousIncompleteParticle(t)) return true;
  return true;
}

export function buildIncompleteSentenceFeedback(shotNumber: number): string {
  return (
    `샷 ${shotNumber}의 내용이 중간에 끊겼다, 완결된 문장으로 다시 작성하라. ` +
    '마침표·느낌표·물음표 또는 자연스러운 종결어미로 끝낼 것.'
  );
}

type CameraKind = 'wide' | 'close' | 'medium' | 'long';

function detectCameraKind(text: string): CameraKind | null {
  const t = normalizeCompareText(text);
  if (t.includes('클로즈') || t.includes('close')) return 'close';
  if (t.includes('와이드') || t.includes('wide')) return 'wide';
  if (t.includes('미디엄') || t.includes('medium')) return 'medium';
  if (t.includes('롱') || t.includes('long')) return 'long';
  return null;
}

export function cameraLabelMatchesAction(shot: VideoContiShot): boolean {
  const cameraKind = detectCameraKind(shot.camera ?? '');
  const firstSentence = trimField(shot.action).split(/[.。!?\n]/)[0] ?? '';
  const actionKind = detectCameraKind(firstSentence);
  if (!cameraKind || !actionKind) return true;
  return cameraKind === actionKind;
}

export function buildCameraMismatchFeedback(shotNumber: number): string {
  return (
    `샷 ${shotNumber}의 camera 라벨과 action 본문 첫 문장의 샷 종류가 일치하지 않는다, ` +
    'camera와 action을 같은 샷 타입으로 맞춰 완결된 문장으로 다시 작성하라.'
  );
}

export type RawShotQualityKind = 'empty' | 'incomplete' | 'camera_mismatch';

export interface RawShotQualityIssue {
  index: number;
  kind: RawShotQualityKind;
  feedback: string;
}

export function findRawShotQualityIssues(conti: VideoConti): RawShotQualityIssue[] {
  const issues: RawShotQualityIssue[] = [];
  for (let i = 0; i < conti.shots.length; i++) {
    const shot = conti.shots[i]!;
    const shotNumber = i + 1;

    const content = validateShotContent(shot, shotNumber);
    if (!content.ok) {
      issues.push({ index: i, kind: 'empty', feedback: content.feedback });
      continue;
    }

    if (isIncompleteSentence(shot.action)) {
      issues.push({ index: i, kind: 'incomplete', feedback: buildIncompleteSentenceFeedback(shotNumber) });
      continue;
    }

    const dialogue = trimField(shot.dialogue);
    if (dialogue && isIncompleteSentence(dialogue)) {
      issues.push({ index: i, kind: 'incomplete', feedback: buildIncompleteSentenceFeedback(shotNumber) });
      continue;
    }

    if (!cameraLabelMatchesAction(shot)) {
      issues.push({ index: i, kind: 'camera_mismatch', feedback: buildCameraMismatchFeedback(shotNumber) });
    }
  }
  return issues;
}

export function findIncompleteLastShotIndex(conti: VideoConti): number | null {
  if (!conti.shots.length) return null;
  const lastIdx = conti.shots.length - 1;
  const issues = findRawShotQualityIssues(conti).filter(
    (issue) => issue.index === lastIdx && issue.kind === 'incomplete',
  );
  return issues.length ? lastIdx : null;
}

export function validateCutTypeMatchesRawShots(
  cutType: VideoConti['cutType'],
  rawShots: VideoContiShot[],
): { ok: true } | { ok: false; feedback: string } {
  const shotCount = rawShots.length;
  const segmentCount = new Set(
    rawShots.map((s) => `${s.startSec ?? 0}-${s.endSec ?? 0}`),
  ).size;

  if (cutType === 'single_shot') {
    if (shotCount >= 2 || segmentCount >= 2) {
      return { ok: false, feedback: SINGLE_SHOT_CUT_MISMATCH_FEEDBACK };
    }
  }

  if (cutType === 'multi_shot' && shotCount < 2) {
    return { ok: false, feedback: MULTI_SHOT_CUT_MISMATCH_FEEDBACK };
  }

  return { ok: true };
}

/** 펀치라인 대사가 있을 가능성이 높은 샷 — 마지막 또는 마지막 직전 */
export function findPunchlineShotIndex(shots: VideoContiShot[]): number {
  if (!shots.length) return -1;
  const last = shots.length - 1;
  const prev = last - 1;
  if (shots[last]?.dialogue?.trim()) return last;
  if (prev >= 0 && shots[prev]?.dialogue?.trim()) return prev;
  return last;
}

export function validatePunchlineShotMinDuration(
  conti: VideoConti,
  minSec = PUNCHLINE_MIN_DURATION_SEC,
): { ok: true } | { ok: false; feedback: string } {
  const idx = findPunchlineShotIndex(conti.shots);
  if (idx < 0) return { ok: true };

  const dur = shotDurationSec(conti.shots[idx]!);
  if (dur >= minSec) return { ok: true };

  return {
    ok: false,
    feedback:
      `펀치라인이 들어가는 샷(샷${idx + 1})은 대사를 끝까지 전달할 수 있도록 최소 ${minSec}초를 확보하라. ` +
      `현재 ${dur}초로 부족하다. 다른 샷 시간을 줄여 펀치라인 샷에 ${minSec}초 이상 배분하라.`,
  };
}

/** 총 길이 유지 — 펀치라인 샷에 최소 minSec 확보 (다른 샷에서 차감) */
export function enforcePunchlineShotMinDuration(conti: VideoConti, minSec = PUNCHLINE_MIN_DURATION_SEC): VideoConti {
  if (!conti.shots.length) return conti;

  const idx = findPunchlineShotIndex(conti.shots);
  if (idx < 0) return conti;

  const durations = conti.shots.map((s) => shotDurationSec(s));
  const total = durations.reduce((a, b) => a + b, 0) || conti.duration;

  if (durations[idx]! >= minSec) {
    return rebuildShotsFromDurations(conti, durations, total);
  }

  let need = minSec - durations[idx]!;
  const donors = durations
    .map((d, i) => ({ i, d }))
    .filter((x) => x.i !== idx && x.d > 0)
    .sort((a, b) => b.d - a.d);

  for (const donor of donors) {
    if (need <= 0) break;
    const floor = SHOT_MIN_DURATION_SEC;
    const take = Math.min(need, Math.max(0, donor.d - floor));
    if (take <= 0) continue;
    durations[donor.i]! -= take;
    durations[idx]! += take;
    need -= take;
  }

  return rebuildShotsFromDurations(conti, durations, total);
}

function rebuildShotsFromDurations(
  conti: VideoConti,
  durations: number[],
  totalDuration: number,
): VideoConti {
  let cursor = 0;
  const shots = conti.shots.map((s, i) => {
    const durationSec = durations[i] ?? 0;
    const startSec = cursor;
    cursor += durationSec;
    return {
      ...s,
      shotNumber: i + 1,
      startSec,
      endSec: cursor,
    };
  });

  const duration = totalDuration > 0 ? totalDuration : cursor;
  return { ...conti, duration, shots };
}
