import { isWeekendKst } from './posting-schedule.js';
import { applyPostingWarmupCap } from './posting-warmup.js';

export interface DailyPostingTarget {
  /** 평일 기준 목표 (3건 고정) */
  weekday_base: number;
  /** 오늘 실제 목표 (워밍업 상한 적용 후) */
  target: number;
  /** 워밍업 적용 전 원시 목표 */
  raw_target: number;
  is_weekend: boolean;
  /** 주말만 — 0.40~0.50 */
  weekend_ratio?: number;
  /** 워밍업 일일 상한 (999 = 제한 없음) */
  warmup_cap?: number;
}

function hashSeed(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** KST YYYY-MM-DD */
export function formatKstDateKey(date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(date);
}

export interface DailyPostingTargetOptions {
  warmupDay?: number;
}

/**
 * 계정·일자별 결정적 목표 — 하루 동안 동일 계정은 같은 값.
 * 평일: 3건 · 주말: 평일 목표의 40~50% (최소 1건)
 * warmup_day로 점진적 상한 적용
 */
export function getDailyPostingTarget(
  accountId: string,
  date = new Date(),
  options?: DailyPostingTargetOptions,
): DailyPostingTarget {
  const dateKey = formatKstDateKey(date);
  const seed = hashSeed(`${accountId.trim()}:${dateKey}`);
  const weekday_base = 3;
  const is_weekend = isWeekendKst(date);
  const warmupDay = options?.warmupDay ?? 999;

  let raw_target: number;
  let weekend_ratio: number | undefined;

  if (!is_weekend) {
    raw_target = weekday_base;
  } else {
    const ratioSeed = (seed >>> 8) % 11;
    weekend_ratio = 0.4 + (ratioSeed / 10) * 0.1;
    raw_target = Math.max(1, Math.round(weekday_base * weekend_ratio));
  }

  const target = applyPostingWarmupCap(raw_target, warmupDay, is_weekend, weekend_ratio);
  const warmup_cap =
    warmupDay >= 999 ? undefined : applyPostingWarmupCap(weekday_base, warmupDay, false);

  return {
    weekday_base,
    target,
    raw_target,
    is_weekend,
    weekend_ratio,
    warmup_cap: warmup_cap && warmup_cap < 999 ? warmup_cap : undefined,
  };
}

