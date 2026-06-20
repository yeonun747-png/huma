import type { VideoConti, VideoContiShot } from './types.js';

export class ContiValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContiValidationError';
  }
}

export const SINGLE_SHOT_CUT_MISMATCH_FEEDBACK =
  'single_shot은 컷 전환이 전혀 없는 한 화면 구성이어야 한다. 현재 결과는 여러 컷으로 나뉘어 있어 single_shot 정의에 맞지 않는다, 컷을 하나로 통합해서 다시 작성하라.';

export const MULTI_SHOT_CUT_MISMATCH_FEEDBACK =
  'multi_shot은 여러 컷(샷)으로 나뉜 구성이어야 한다. 현재 샷이 1개만 생성되어 multi_shot 정의에 맞지 않는다, 최소 2개 이상의 샷으로 다시 작성하라.';

export const PUNCHLINE_MIN_DURATION_SEC = 2;

function shotDurationSec(shot: VideoContiShot): number {
  const d = shot.endSec - shot.startSec;
  return d > 0 ? d : 0;
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
    const floor = conti.shots.length <= 2 ? 0 : 1;
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
