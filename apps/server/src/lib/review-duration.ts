import { randomBetween } from './utils.js';

/** 휴먼엔진 review_duration_ms(900자 기준 2~5분)를 본문 길이에 비례 조정 */
export function calcReviewDurationMs(
  charCount: number,
  reviewDurationMs: [number, number],
  refChars = 900,
): number {
  const [baseMin, baseMax] = reviewDurationMs;
  const clamped = Math.max(400, Math.min(charCount, refChars * 1.15));
  const scale = clamped / refChars;
  const min = Math.round(baseMin * scale);
  const max = Math.round(baseMax * scale);
  const floor = 45_000;
  const lo = Math.max(floor, min);
  const hi = Math.max(lo + 20_000, max);
  return randomBetween(lo, hi);
}
