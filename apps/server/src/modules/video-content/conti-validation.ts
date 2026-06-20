import type { VideoConti, VideoContiShot } from './types.js';
import {
  EVOLINK_MAX_SHOTS,
  getShotCountBounds,
  DEFAULT_MULTI_SHOT_COMPOSITION,
} from './shot-timing.js';

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
/** single_shot 2단계 — shots 1개만 생성 */
export const CONTI_SINGLE_SHOTS_MAX_TOKENS = 2048;
export const CONTI_SHOT_FILL_MAX_TOKENS = 2048;
export const MAX_SINGLE_SHOT_CUT_REGENERATION_ATTEMPTS = 1;

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

/** multi_shot 2단계 프롬프트 — 고정 N샷 템플릿 대신 구성 원칙 */
export function buildMultiShotCompositionGuide(duration: number): string {
  const bounds = getShotCountBounds(duration);
  return (
    `${DEFAULT_MULTI_SHOT_COMPOSITION}\n` +
    `이번 ${duration}초 영상: 샷 개수 ${bounds.min}~${bounds.max}개 중 시나리오에 맞게 선택 (API 상한 ${EVOLINK_MAX_SHOTS}개).\n` +
    `${buildMinShotDurationRule(duration)}\n` +
    `${buildNoDuplicateFillRule()}\n` +
    `${buildAdjacentShotDistinctRule()}`
  );
}

export function buildSingleShotDurationRule(duration: number): string {
  return (
    `shots 배열은 요소 1개만. startSec=0, endSec=${duration} (${duration}초 전체). ` +
    '컷 전환·카메라 앵글 변경 없음. 시간 흐름은 action 문장 안 [0~3초]… 형태로만 표현.'
  );
}

export function buildSingleShotFoundationCutRule(): string {
  return (
    '이번 영상 cut_type=single_shot. 2단계 JSON shots 배열은 반드시 1개만. ' +
    'shotNumber 2 이상·여러 startSec/endSec 구간으로 나뉜 shots 객체 금지. ' +
    '시간 전개(4~5비트)는 하나의 action 문자열 안에서만 표현하고 컷/카메라 전환은 없다.'
  );
}

export function buildMultiShotFoundationCutRule(personaRule?: string): string {
  const base = personaRule?.trim();
  if (base) return `이번 영상 cut_type=multi_shot.\n${base}`;
  return '이번 영상 cut_type=multi_shot. 여러 컷(샷)으로 구성.';
}

export function buildSingleShotGuide(duration: number, personaGuide?: string): string {
  const extra = personaGuide?.trim();
  const punchlineRule = `펀치라인 대사는 이 1개 shot의 dialogue에 담고, ${duration}초 안에 끝까지 전달 가능하게 작성.`;
  return (
    `싱글샷 (${duration}초) — JSON shots 배열 길이는 반드시 1.\n` +
    `${buildSingleShotDurationRule(duration)}\n` +
    `${buildShotContentRule()}\n` +
    `${punchlineRule}` +
    (extra ? `\n${extra}` : '')
  );
}

export function buildCharacterNamingRule(): string {
  return (
    '등장인물은 A, B(또는 인물1, 인물2)로 지칭하거나, 혹은 시나리오 시작 시점에 이름을 부여하려면 등장인물 설정 섹션에 그 이름을 함께 기재해야 한다. ' +
    '등장인물 설정 섹션에 없는 이름이 샷 본문에서 갑자기 등장해서는 안 된다. ' +
    '한번 이름을 정했다면 첫 등장 샷부터 마지막 샷까지 동일한 이름을 일관되게 사용해야 한다.'
  );
}

export function buildCameraActionNoRepeatRule(): string {
  return (
    '각 샷의 카메라 디렉션은 camera 라벨 부분에 한 번만 명시하고, action 본문에서 카메라 종류(와이드샷, 클로즈업 등)를 다시 반복해서 쓰지 않는다. ' +
    'action 본문은 인물의 행동, 표정, 대사 중심으로 작성한다.'
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
    `shots_max_tokens=${CONTI_SHOTS_MAX_TOKENS} single_shots_max_tokens=${CONTI_SINGLE_SHOTS_MAX_TOKENS} ` +
    `shot_fill_max_tokens=${CONTI_SHOT_FILL_MAX_TOKENS}`
  );
}

export function buildSentenceCompleteRule(): string {
  return (
    '각 샷 action/dialogue는 마침표·느낌표·물음표 또는 자연스러운 한글 종결어미로 끝나는 완결된 문장이어야 한다. ' +
    '단어 중간에서 끊기거나 조사만 남은 채 끝나면 안 된다.'
  );
}

export function buildShotContentRule(): string {
  return (
    `모든 샷 action 필드는 ${SHOT_CONTENT_MIN_CHARS}자 이상의 구체적 행동·표정 묘사 필수. ` +
    `대사가 있는 샷은 dialogue도 ${SHOT_CONTENT_MIN_CHARS}자 이상. ` +
    `"장면 전개", "내용 없음", "TBD" 등 자리표시자 금지. ` +
    `${buildAdjacentShotDistinctRule()} ${buildSentenceCompleteRule()} ${buildCameraActionNoRepeatRule()} ${buildCharacterNamingRule()}`
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
  if (/[,，、]$/.test(t)) return true;
  if (/[\("「『]$/.test(t)) return true;
  return false;
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

/** action 본문에 카메라 지시어가 반복되는지 — 형용사(클로즈한) 오탐 방지 */
const CAMERA_PHRASE_IN_ACTION =
  /(?:와이드\s*샷|와이드\s*프레임|wide\s*shot|클로즈\s*업|클로즈\s*샷|close[\s-]*up|미디엄\s*샷|medium\s*shot|롱\s*샷|long\s*shot)/i;

export function actionMentionsCameraKind(shot: VideoContiShot): boolean {
  if (detectCameraKind(shot.camera ?? '') == null) return false;
  return CAMERA_PHRASE_IN_ACTION.test(trimField(shot.action));
}

export function buildCameraInActionFeedback(shotNumber: number): string {
  return (
    `샷 ${shotNumber} action 본문에 카메라 종류(와이드/클로즈업 등)를 반복하지 말고, ` +
    'camera 라벨에만 명시하고 본문은 인물 행동·표정 중심으로 완결된 문장으로 다시 작성하라.'
  );
}

/** @deprecated actionMentionsCameraKind 사용 */
export function cameraLabelMatchesAction(shot: VideoContiShot): boolean {
  return !actionMentionsCameraKind(shot);
}

/** @deprecated buildCameraInActionFeedback 사용 */
export function buildCameraMismatchFeedback(shotNumber: number): string {
  return buildCameraInActionFeedback(shotNumber);
}

export type RawShotQualityKind = 'empty' | 'incomplete' | 'camera_in_action';

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

    if (actionMentionsCameraKind(shot) && conti.cutType !== 'single_shot') {
      issues.push({ index: i, kind: 'camera_in_action', feedback: buildCameraInActionFeedback(shotNumber) });
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

const GENERIC_CHARACTER_LABEL = /^(?:[A-Z]|인물?\d+)$/i;

function isGenericCharacterLabel(label: string): boolean {
  return GENERIC_CHARACTER_LABEL.test(label.trim());
}

const PERSON_NAME_STOPWORDS = new Set([
  '남자',
  '여자',
  '사람',
  '표정',
  '고개',
  '눈빛',
  '카메라',
  '와이드',
  '미디엄',
  '클로즈',
  '롱샷',
  '배경',
  '화면',
  '장면',
  '대사',
  '행동',
  '손가',
  '손을',
  '눈을',
  '입을',
  '목소',
  '한숨',
  '미소',
  '웃음',
  '시선',
  '거리',
  '카페',
  '공원',
  '집안',
  '창가',
  '벤치',
  '테이블',
  '의자',
  '문을',
  '바닥',
  '하늘',
  '거울',
  '전화',
  '휴대',
  '폰을',
  '음료',
  '허공',
  '팔짱',
  '입꼬리',
  '입술',
  '눈썹',
  '미간',
  '코웃',
  '등받',
]);

/** 대화에서만 — 호칭·존칭 패턴 (조사 이/가/을/를 패턴은 action 오탐 유발로 제외) */
const DIALOGUE_NAME_PATTERNS = [
  /([가-힣]{2,4})(?:씨|님)(?=[,.!?\s"']|$)/g,
  /([가-힣]{2,4})(?:야|아)(?=[,.!?\s"']|$)/g,
];

/** 대화 호칭 오탐 — "아니야", "그래" 등 */
const DIALOGUE_VOCATIVE_STOPWORDS = new Set([
  '아니',
  '그래',
  '진짜',
  '정말',
  '맞아',
  '맞잖',
  '왜야',
  '뭐야',
  '어때',
  '그게',
  '이게',
  '저기',
  '야',
  '아',
]);

export function hasExplicitCharacterNames(conti: VideoConti): boolean {
  return conti.characters.some((ch) => {
    if (trimField(ch.name)) return true;
    const label = trimField(ch.label);
    return Boolean(label && !isGenericCharacterLabel(label) && /^[가-힣]{2,4}$/.test(label));
  });
}

export const CHARACTER_NAME_MISMATCH_FEEDBACK =
  '본문에서 사용한 인물 이름이 등장인물 설정 섹션에 반영되지 않았다. 등장인물 설정 섹션에 사용할 이름을 명시하고, 모든 샷에서 동일한 이름을 일관되게 사용해서 다시 작성하라.';

export function extractAllowedCharacterIdentifiers(
  conti: VideoConti,
  extraAllowed: string[] = [],
): Set<string> {
  const allowed = new Set<string>();
  for (const extra of extraAllowed) {
    const t = trimField(extra);
    if (t) allowed.add(t);
  }
  for (const ch of conti.characters) {
    const label = trimField(ch.label);
    if (label) allowed.add(label);
    const name = trimField(ch.name);
    if (name) allowed.add(name);
    if (label && !isGenericCharacterLabel(label) && /^[가-힣]{2,4}$/.test(label)) {
      allowed.add(label);
    }
  }
  return allowed;
}

export function extractPersonReferenceNames(text: string): string[] {
  const found = new Set<string>();
  for (const pattern of DIALOGUE_NAME_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const name = match[1];
      if (!name) continue;
      if (PERSON_NAME_STOPWORDS.has(name)) continue;
      if (DIALOGUE_VOCATIVE_STOPWORDS.has(name)) continue;
      found.add(name);
    }
  }
  return [...found];
}

export function findUnregisteredCharacterNames(
  conti: VideoConti,
  extraAllowed: string[] = [],
): string[] {
  // A/B·인물1 라벨만 있으면 이름 검증 스킵 (연운·퀴즈 기본)
  if (!hasExplicitCharacterNames(conti) && !extraAllowed.some((n) => trimField(n))) {
    return [];
  }

  const allowed = extractAllowedCharacterIdentifiers(conti, extraAllowed);
  const unregistered = new Set<string>();
  for (const shot of conti.shots) {
    const dialogue = trimField(shot.dialogue);
    if (!dialogue) continue;
    for (const name of extractPersonReferenceNames(dialogue)) {
      if (!allowed.has(name)) unregistered.add(name);
    }
  }
  return [...unregistered];
}

export function validateCharacterNameConsistency(
  conti: VideoConti,
  extraAllowed: string[] = [],
): { ok: true } | { ok: false; feedback: string; unregisteredNames: string[] } {
  const unregistered = findUnregisteredCharacterNames(conti, extraAllowed);
  if (!unregistered.length) return { ok: true };
  return {
    ok: false,
    feedback: `${CHARACTER_NAME_MISMATCH_FEEDBACK} (미등록 이름: ${unregistered.join(', ')})`,
    unregisteredNames: unregistered,
  };
}

/** A/B 라벨이 아닌 실제 부여 이름 — character_names 저장용 */
export function extractCharacterNamesForStorage(
  conti: VideoConti,
  pananaCharacterName?: string,
): string[] {
  const names = new Set<string>();
  const panana = trimField(pananaCharacterName);
  if (panana) names.add(panana);
  for (const ch of conti.characters) {
    const name = trimField(ch.name);
    if (name) names.add(name);
    const label = trimField(ch.label);
    if (label && !isGenericCharacterLabel(label) && /^[가-힣]{2,4}$/.test(label)) {
      names.add(label);
    }
  }
  return [...names];
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
