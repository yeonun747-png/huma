import type { VideoConti, VideoContiShot } from './types.js';

export class ContiValidationError extends Error {
  readonly maxAttempts: number;
  readonly holdOnFailure: boolean;

  constructor(
    message: string,
    options?: { maxAttempts?: number; holdOnFailure?: boolean },
  ) {
    super(message);
    this.name = 'ContiValidationError';
    this.maxAttempts = options?.maxAttempts ?? DEFAULT_CONTI_VALIDATION_MAX_ATTEMPTS;
    this.holdOnFailure = options?.holdOnFailure ?? false;
  }
}

export const DEFAULT_CONTI_VALIDATION_MAX_ATTEMPTS = 3;
export const MAX_SHOT_DURATION_REGENERATION_ATTEMPTS = 2;
export const SHOT_MIN_DURATION_SEC = 1.5;

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

export function buildMinShotDurationRule(duration: number): string {
  return (
    `모든 개별 샷은 최소 ${SHOT_MIN_DURATION_SEC}초 이상이어야 한다. ` +
    `0초 또는 1초 미만의 샷 금지. ${buildDurationShotCountGuide(duration)}`
  );
}

/** LLM raw shots 기준 — normalizeMultiShotConti 이전에 검사 */
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
