/** EvoLink Kling 멀티샷 API 상한 */
export const EVOLINK_MAX_SHOTS = 6;

/** @deprecated EVOLINK_MAX_SHOTS 사용 — 하위 호환 alias */
export const MULTI_SHOT_COUNT = EVOLINK_MAX_SHOTS;

export const SHOT_TIMING_MIN_SEC = 1.5;

export interface ShotCountBounds {
  min: number;
  max: number;
}

/** 영상 길이별 권장 샷 개수 범위 (EvoLink 상한 6, 샷당 최소 1.5초) */
export function getShotCountBounds(duration: number, minSec = SHOT_TIMING_MIN_SEC): ShotCountBounds {
  const hardMax = Math.min(EVOLINK_MAX_SHOTS, Math.floor(duration / minSec));
  const guides: Record<number, { min: number; max: number }> = {
    9: { min: 4, max: 5 },
    11: { min: 4, max: 6 },
    13: { min: 5, max: 6 },
    15: { min: 5, max: 6 },
  };
  const g = guides[duration] ?? { min: 4, max: Math.min(6, hardMax) };
  const min = Math.max(2, Math.min(g.min, hardMax));
  const max = Math.max(min, Math.min(g.max, hardMax));
  return { min, max };
}

/** LLM이 결정한 샷 수를 길이·API 제약 범위로 보정 */
export function resolveMultiShotCount(sourceCount: number, duration: number): number {
  const bounds = getShotCountBounds(duration);
  let n = Math.max(2, sourceCount);
  if (n < bounds.min) n = bounds.min;
  if (n > bounds.max) n = bounds.max;
  return n;
}

/** N개 샷에 duration 배분 — 각 샷 ≥ minSec, 합계 = duration (첫·끝·펀치라인 구간에 약간 가중) */
export function distributeShotDurations(
  totalDuration: number,
  shotCount: number,
  minSec = SHOT_TIMING_MIN_SEC,
): number[] {
  if (shotCount <= 0) throw new Error('shotCount must be positive');
  const minTotal = shotCount * minSec;
  if (totalDuration < minTotal) {
    throw new Error(`${totalDuration}초 영상은 ${shotCount}샷×${minSec}초 최소를 만족할 수 없음`);
  }

  const available = totalDuration - minTotal;
  const weights = Array.from({ length: shotCount }, (_, i) => {
    if (i === 0 || i === shotCount - 1) return 1.2;
    if (i === shotCount - 2 && shotCount >= 3) return 1.15;
    return 1;
  });
  const weightSum = weights.reduce((a, b) => a + b, 0);
  const extraFloat = weights.map((w) => (w / weightSum) * available);
  const extras = extraFloat.map((e) => Math.floor(e));
  let remainder = Math.round(available - extras.reduce((a, b) => a + b, 0));
  const order = extraFloat
    .map((e, i) => ({ i, frac: e - extras[i]! }))
    .sort((a, b) => b.frac - a.frac);
  for (let j = 0; j < remainder; j++) {
    extras[order[j % shotCount]!.i]! += 1;
  }
  return extras.map((extra) => minSec + extra);
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
- 샷 개수: 영상 길이별 4~6개 범위에서 이번 시나리오에 맞게 결정 (EvoLink API 상한 6개)
- 펀치라인 위치: 고정 샷 번호 없음. 감정곡선·펀치라인 메커니즘에 맞게 중후반 적절한 샷에 배치
- 편집 리듬: 와이드/클로즈/미디엄 순서와 템포를 매번 다르게 설계
- 첫 샷: 상황 도입, 마지막 샷: 여운 마무리 (구체적 카메라·앵글은 자유)
- 모든 개별 샷은 최소 1.5초 이상. startSec/endSec 합 = 영상 duration
- 내용이 빈약하면 샷 개수를 줄이고 남은 샷에 시간을 재배분`;

/** @deprecated DEFAULT_MULTI_SHOT_COMPOSITION 사용 */
export const MULTI_SHOT_TEMPLATE_15S = DEFAULT_MULTI_SHOT_COMPOSITION;
