/** EvoLink Kling 멀티샷 API 상한 */
export const EVOLINK_MAX_SHOTS = 6;

/** @deprecated EVOLINK_MAX_SHOTS 사용 — 하위 호환 alias */
export const MULTI_SHOT_COUNT = EVOLINK_MAX_SHOTS;

export const SHOT_TIMING_MIN_SEC = 1.5;
export const VIDEO_DURATION_MIN_SEC = 11;
export const VIDEO_DURATION_MAX_SEC = 15;

export function toHalfUnits(sec: number): number {
  return Math.round(sec * 2);
}

export function fromHalfUnits(units: number): number {
  return units / 2;
}

/** Kling API·콘티 duration — 11~15초 정수만 */
export function normalizeVideoDurationSec(duration: number): number {
  const rounded = Math.round(duration);
  return Math.min(VIDEO_DURATION_MAX_SEC, Math.max(VIDEO_DURATION_MIN_SEC, rounded));
}

export interface ShotCountBounds {
  min: number;
  max: number;
}

/** 영상 길이별 권장 샷 개수 범위 (EvoLink 상한 6, 샷당 최소 1.5초) */
export function getShotCountBounds(duration: number, minSec = SHOT_TIMING_MIN_SEC): ShotCountBounds {
  const d = normalizeVideoDurationSec(duration);
  const hardMax = Math.min(EVOLINK_MAX_SHOTS, Math.floor(d / minSec));
  const min = d >= 13 ? 5 : 4;
  const maxCap = d >= 13 ? 6 : 5;
  const minBound = Math.max(2, Math.min(min, hardMax));
  const maxBound = Math.max(minBound, Math.min(maxCap, hardMax));
  return { min: minBound, max: maxBound };
}

/** LLM이 결정한 샷 수를 길이·API 제약 범위로 보정 */
export function resolveMultiShotCount(sourceCount: number, duration: number): number {
  const bounds = getShotCountBounds(duration);
  let n = Math.max(2, sourceCount);
  if (n < bounds.min) n = bounds.min;
  if (n > bounds.max) n = bounds.max;
  return n;
}

/** N개 샷에 duration 배분 — 0.5초 단위, 합계 = totalDuration(정수) 정확히 일치 */
export function distributeShotDurations(
  totalDuration: number,
  shotCount: number,
  minSec = SHOT_TIMING_MIN_SEC,
): number[] {
  if (shotCount <= 0) throw new Error('shotCount must be positive');

  const totalHalf = toHalfUnits(normalizeVideoDurationSec(totalDuration));
  const minHalf = toHalfUnits(minSec);
  const minTotalHalf = shotCount * minHalf;
  if (totalHalf < minTotalHalf) {
    throw new Error(`${totalDuration}초 영상은 ${shotCount}샷×${minSec}초 최소를 만족할 수 없음`);
  }

  const availableHalf = totalHalf - minTotalHalf;
  const weights = Array.from({ length: shotCount }, (_, i) => {
    if (i === 0 || i === shotCount - 1) return 1.2;
    if (i === shotCount - 2 && shotCount >= 3) return 1.15;
    return 1;
  });
  const weightSum = weights.reduce((a, b) => a + b, 0);
  const extraFloat = weights.map((w) => (w / weightSum) * availableHalf);
  const extrasHalf = extraFloat.map((e) => Math.floor(e));
  let remainderHalf = availableHalf - extrasHalf.reduce((a, b) => a + b, 0);
  const order = extraFloat
    .map((e, i) => ({ i, frac: e - extrasHalf[i]! }))
    .sort((a, b) => b.frac - a.frac);
  for (let j = 0; j < remainderHalf; j++) {
    extrasHalf[order[j % shotCount]!.i]! += 1;
  }

  return extrasHalf.map((extraHalf) => fromHalfUnits(minHalf + extraHalf));
}

/** 기존 샷 길이를 0.5초 단위로 유지하며 합계를 targetTotalSec(정수)에 맞춤 */
export function snapShotDurationsToTotal(
  shotDurationsSec: number[],
  targetTotalSec: number,
  minSec = SHOT_TIMING_MIN_SEC,
): number[] {
  if (!shotDurationsSec.length) return [];

  const targetHalf = toHalfUnits(normalizeVideoDurationSec(targetTotalSec));
  const minHalf = toHalfUnits(minSec);
  const half = shotDurationsSec.map((d) => Math.max(minHalf, toHalfUnits(d)));
  let sumHalf = half.reduce((a, b) => a + b, 0);

  if (sumHalf === targetHalf) {
    return half.map(fromHalfUnits);
  }

  let diffHalf = targetHalf - sumHalf;
  let idx = half.length - 1;
  while (diffHalf !== 0 && idx >= 0) {
    const candidate = half[idx]! + diffHalf;
    if (candidate >= minHalf) {
      half[idx]! = candidate;
      diffHalf = 0;
      break;
    }
    const give = half[idx]! - minHalf;
    half[idx]! = minHalf;
    diffHalf += give;
    idx -= 1;
  }

  if (diffHalf !== 0) {
    return distributeShotDurations(normalizeVideoDurationSec(targetTotalSec), shotDurationsSec.length, minSec);
  }

  return half.map(fromHalfUnits);
}

export function buildMultiShotTimeline(
  totalDuration: number,
  shotCount: number,
): Array<{ shotNumber: number; startSec: number; endSec: number; durationSec: number }> {
  const durations = distributeShotDurations(totalDuration, shotCount);
  let cursor = 0;
  return durations.map((durationSec, i) => {
    const startSec = cursor;
    cursor += durationSec;
    return { shotNumber: i + 1, startSec, endSec: cursor, durationSec };
  });
}

/** @deprecated resolveMultiShotCount + buildMultiShotTimeline 사용 */
export function scaleSixShotDurations(totalDuration: number, minSec = SHOT_TIMING_MIN_SEC): number[] {
  return distributeShotDurations(totalDuration, EVOLINK_MAX_SHOTS, minSec);
}

/** @deprecated buildMultiShotTimeline(duration, resolveMultiShotCount(n, duration)) 사용 */
export function buildSixShotTimeline(totalDuration: number) {
  return buildMultiShotTimeline(totalDuration, EVOLINK_MAX_SHOTS);
}

/** 페르소나 기본값용 — 고정 6샷 템플릿 대신 구성 원칙 */
export const DEFAULT_MULTI_SHOT_COMPOSITION = `multi_shot 구성 원칙 (고정 템플릿 아님 — 매 영상 시나리오에 맞게 재구성):
- 샷 개수: 11~12초 4~5개, 13~15초 5~6개 (EvoLink API 상한 6개) — 시나리오에 맞게 선택
- 펀치라인 위치: 고정 샷 번호 없음. 감정곡선·펀치라인 메커니즘에 맞게 중후반 적절한 샷에 배치
- 편집 리듬: 와이드/클로즈/미디엄 순서와 템포를 매번 다르게 설계
- 첫 샷: 상황 도입, 마지막 샷: 여운 마무리 (구체적 카메라·앵글은 자유)
- 모든 개별 샷은 최소 1.5초 이상. startSec/endSec 합 = 영상 duration
- 내용이 빈약하면 샷 개수를 줄이고 남은 샷에 시간을 재배분`;

/** @deprecated DEFAULT_MULTI_SHOT_COMPOSITION 사용 */
export const MULTI_SHOT_TEMPLATE_15S = DEFAULT_MULTI_SHOT_COMPOSITION;
