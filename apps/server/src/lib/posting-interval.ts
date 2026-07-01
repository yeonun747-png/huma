import { ABSOLUTE_MIN_PUBLISH_INTERVAL_HOURS } from './posting-warmup.js';
import { randomBetween } from './utils.js';

export function kstNowParts(date = new Date()): {
  y: number;
  m: number;
  d: number;
  hour: number;
  minute: number;
} {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return { y: get('year'), m: get('month'), d: get('day'), hour: get('hour'), minute: get('minute') };
}

export function kstDateTimeToUtc(y: number, m: number, d: number, hour: number, minute: number): Date {
  const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+09:00`;
  return new Date(iso);
}

/**
 * 당일 가능한 한 이른 발행 시각 — now·활성창 시작·직전 발행+최소간격 중 가장 늦은 시각을 baseline.
 */
export function computeEarliestPostingCandidate(opts: {
  now?: Date;
  winStartHour: number;
  minGapMs: number;
  lastAnchor: Date | null;
}): Date {
  const now = opts.now ?? new Date();
  const nowMs = now.getTime();
  const kst = kstNowParts(now);
  const windowStart = kstDateTimeToUtc(kst.y, kst.m, kst.d, opts.winStartHour, 0);

  let candidate = new Date(nowMs + randomBetween(2, 8) * 60_000);
  if (windowStart.getTime() > candidate.getTime()) {
    candidate = new Date(windowStart.getTime() + randomBetween(1, 8) * 60_000);
  }
  if (opts.lastAnchor) {
    const earliest = opts.lastAnchor.getTime() + opts.minGapMs + randomBetween(1, 8) * 60_000;
    if (candidate.getTime() < earliest) candidate = new Date(earliest);
  }
  return candidate;
}

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
