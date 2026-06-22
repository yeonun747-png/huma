import { ABSOLUTE_MIN_PUBLISH_INTERVAL_HOURS } from './posting-warmup.js';

/** active_hours intensity ≥ threshold 인 시간대 창 */
export function deriveActiveHourWindow(
  activeHours: number[],
  minIntensity = 0.25,
): { start: number; end: number } {
  const active: number[] = [];
  for (let h = 0; h < 24; h++) {
    if ((activeHours[h] ?? 0) >= minIntensity) active.push(h);
  }
  if (!active.length) return { start: 8, end: 22 };
  return { start: active[0], end: active[active.length - 1] + 1 };
}

/** 활성 시간대 스팬(시간) */
export function getActivePostingWindowHours(activeHours: number[]): number {
  const { start, end } = deriveActiveHourWindow(activeHours.length === 24 ? activeHours : [], 0.25);
  return Math.max(6, end - start);
}

/**
 * 오늘 목표 건수·활성창 기준 동적 최소 간격(시간).
 * floorHours(기본 2h) 미만으로는 내려가지 않음.
 */
export function computeDynamicPublishIntervalHours(
  dailyTarget: number,
  activeWindowHours: number,
  floorHours = ABSOLUTE_MIN_PUBLISH_INTERVAL_HOURS,
): number {
  const target = Math.max(1, dailyTarget);
  const windowH = Math.max(4, activeWindowHours);
  const avgGap = windowH / target;
  const dynamic = avgGap * 0.72;
  return Math.max(floorHours, Math.round(dynamic * 10) / 10);
}
