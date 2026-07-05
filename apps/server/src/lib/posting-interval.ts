import {
  ABSOLUTE_MIN_PUBLISH_INTERVAL_HOURS,
  resolvePostingScheduleSpreadFraction,
} from './posting-warmup.js';
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

/**
 * warmup_day에 따라 활성창 안에서 earliest~latest 사이 랜덤 시각 — 초기 단계일수록 분산 폭 확대.
 */
export function computePostingScheduleCandidate(opts: {
  now?: Date;
  winStartHour: number;
  winEndHour: number;
  minGapMs: number;
  lastAnchor: Date | null;
  warmupDay?: number;
  /** 환경설정·워밍업 패널의 오늘 발행 목표 — 저발행량일수록 활성창 전체에 분산 */
  dailyTarget?: number;
}): Date {
  const earliest = computeEarliestPostingCandidate({
    now: opts.now,
    winStartHour: opts.winStartHour,
    minGapMs: opts.minGapMs,
    lastAnchor: opts.lastAnchor,
  });

  const fraction = resolvePostingScheduleSpreadFraction(
    opts.warmupDay ?? 0,
    opts.dailyTarget ?? 1,
  );
  if (fraction <= 0.05) return earliest;

  const now = opts.now ?? new Date();
  const kst = kstNowParts(now);
  const windowStartMs = kstDateTimeToUtc(kst.y, kst.m, kst.d, opts.winStartHour, 0).getTime();
  const windowEndMs = kstDateTimeToUtc(kst.y, kst.m, kst.d, opts.winEndHour, 0).getTime();
  const windowMs = Math.max(30 * 60_000, windowEndMs - windowStartMs);

  const earliestMs = earliest.getTime();
  const maxSpreadMs = Math.floor(windowMs * fraction);
  const endBufferMs = randomBetween(5, 15) * 60_000;
  const latestMs = Math.min(windowEndMs - endBufferMs, earliestMs + maxSpreadMs);

  if (latestMs <= earliestMs + 60_000) return earliest;

  return new Date(randomBetween(earliestMs, latestMs));
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
