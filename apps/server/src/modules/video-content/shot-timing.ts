/** 15초 기준 6샷 길이(초): 샷1=3, 샷2=1, 샷3=3, 샷4=3, 샷5=3, 샷6=2 */
const BASE_SHOT_DURATIONS = [3, 1, 3, 3, 3, 2];
const BASE_TOTAL = 15;

/** duration(9|11|13|15)에 맞게 6샷 길이를 비례 배분 — 합계 = duration */
export function scaleSixShotDurations(totalDuration: number): number[] {
  const scaled = BASE_SHOT_DURATIONS.map((d) => (d * totalDuration) / BASE_TOTAL);
  const floors = scaled.map((d) => Math.floor(d));
  let remainder = totalDuration - floors.reduce((a, b) => a + b, 0);
  const order = scaled
    .map((d, i) => ({ i, frac: d - floors[i]! }))
    .sort((a, b) => b.frac - a.frac);
  const result = [...floors];
  for (let j = 0; j < remainder; j++) {
    result[order[j % order.length]!.i]++;
  }
  return result;
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

export const MULTI_SHOT_COUNT = 6;

export const MULTI_SHOT_TEMPLATE_15S = `
샷1(0~3초): 와이드샷. 상황 설정 + 첫 대사.
샷2(3~4초): 인물A 클로즈업. 반응 비트 (대사 없어도 됨).
샷3(4~7초): 인물B 클로즈업/미디엄. 행동+짧은 대사, 카메라 틸트/팬으로 손·사물 디테일 함께.
샷4(7~10초): 미디엄샷. 핵심 전개, 두 인물 리액션.
샷5(10~13초): 클로즈업. 인물A 반응 → 같은 샷에서 인물B로 시선 전환, 후반 펀치라인 대사.
샷6(13~15초): 와이드샷. 여운 마무리, 페이드아웃.`.trim();
