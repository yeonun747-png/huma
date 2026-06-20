/** 15초 기준 6샷 상대 비중 — 절대 초 단위 아님 */
const BASE_SHOT_WEIGHTS = [3, 1, 3, 3, 3, 2];
const BASE_TOTAL = 15;
export const MULTI_SHOT_COUNT = BASE_SHOT_WEIGHTS.length;

/** duration(9|11|13|15)에 맞게 6샷 길이 배분 — 각 샷 ≥ minSec, 합계 = duration */
export function scaleSixShotDurations(
  totalDuration: number,
  minSec = 1.5,
): number[] {
  const n = BASE_SHOT_WEIGHTS.length;
  const minTotal = n * minSec;
  if (totalDuration < minTotal) {
    throw new Error(`${totalDuration}초 영상은 ${n}샷×${minSec}초 최소를 만족할 수 없음`);
  }

  const available = totalDuration - minTotal;
  const weights = BASE_SHOT_WEIGHTS.map((d) => d / BASE_TOTAL);
  const extraFloat = weights.map((w) => w * available);
  const extras = extraFloat.map((e) => Math.floor(e));
  let remainder = Math.round(available - extras.reduce((a, b) => a + b, 0));
  const order = extraFloat
    .map((e, i) => ({ i, frac: e - extras[i]! }))
    .sort((a, b) => b.frac - a.frac);
  for (let j = 0; j < remainder; j++) {
    extras[order[j % n]!.i]! += 1;
  }
  return extras.map((extra) => minSec + extra);
}

export function buildSixShotTimeline(totalDuration: number): Array<{ shotNumber: number; startSec: number; endSec: number; durationSec: number }> {
  const durations = scaleSixShotDurations(totalDuration);
  let cursor = 0;
  return durations.map((durationSec, i) => {
    const startSec = cursor;
    cursor += durationSec;
    return { shotNumber: i + 1, startSec, endSec: cursor, durationSec };
  });
}

export const MULTI_SHOT_TEMPLATE_15S = `
샷1(0~3초): 와이드샷. 상황 설정 + 첫 대사.
샷2(3~4초): 인물A 클로즈업. 반응 비트 (대사 없어도 됨).
샷3(4~7초): 인물B 클로즈업/미디엄. 행동+짧은 대사, 카메라 틸트/팬으로 손·사물 디테일 함께.
샷4(7~10초): 미디엄샷. 핵심 전개, 두 인물 리액션.
샷5(10~13초): 클로즈업. 인물A 반응 → 같은 샷에서 인물B로 시선 전환, 후반 펀치라인 대사.
샷6(13~15초): 와이드샷. 여운 마무리, 페이드아웃.`.trim();
