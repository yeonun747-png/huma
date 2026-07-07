import {
  DEFAULT_NIGHT_BAN_END,
  DEFAULT_NIGHT_BAN_START,
  isKstNightBan,
  msUntilNightBanStart,
} from './crank-schedule-config.js';
import {
  computeEarliestPostingCandidate,
  computePostingScheduleCandidate,
  deriveActiveHourWindow,
  kstNowParts,
  kstDateTimeToUtc,
} from './posting-interval.js';
import { randomBetween } from './utils.js';

/** 활성 시간대 + 야간 발행 금지 시작 시각을 반영한 당일 발행 가능 창 */
export function resolvePostingDayWindow(
  activeHours: number[],
  nightBanStart = DEFAULT_NIGHT_BAN_START,
): { start: number; end: number } {
  const { start, end } = deriveActiveHourWindow(activeHours.length === 24 ? activeHours : [], 0.25);
  return { start, end: Math.min(end, nightBanStart) };
}

/** 오늘 남은 발행 슬롯이 야간 금지 전에 다 들어가지 않으면 최대한 이른 시각 우선 */
export function shouldPackPostingBeforeNightBan(opts: {
  remainingSlots: number;
  minGapMs: number;
  nightBanStart?: number;
  nightBanEnd?: number;
  from?: Date;
}): boolean {
  const remaining = Math.max(1, opts.remainingSlots);
  const nightBanStart = opts.nightBanStart ?? DEFAULT_NIGHT_BAN_START;
  const nightBanEnd = opts.nightBanEnd ?? DEFAULT_NIGHT_BAN_END;
  const from = opts.from ?? new Date();
  const msUntilBan = msUntilNightBanStart(nightBanStart, nightBanEnd, from);
  if (msUntilBan <= 0) return true;
  return msUntilBan < opts.minGapMs * remaining;
}

export function clampCandidateBeforeNightBan(
  candidate: Date,
  nightBanStart = DEFAULT_NIGHT_BAN_START,
  nightBanEnd = DEFAULT_NIGHT_BAN_END,
  now = new Date(),
): Date {
  if (!isKstNightBan(nightBanStart, nightBanEnd, candidate)) {
    return candidate;
  }

  const kst = kstNowParts(candidate);
  const y = kst.y;
  const m = kst.m;
  const d = kst.d;

  // 23:00~ — 가능하면 당일 금지 직전(22:48~22:57), 불가 시 익일 08:00+
  if (kst.hour >= nightBanStart) {
    const preBanMs =
      kstDateTimeToUtc(y, m, d, nightBanStart, 0).getTime() - randomBetween(3, 12) * 60_000;
    if (preBanMs > now.getTime()) {
      return new Date(preBanMs);
    }
    const nextNoon = kstDateTimeToUtc(y, m, d, 12, 0);
    const nextKst = kstNowParts(new Date(nextNoon.getTime() + 24 * 3_600_000));
    const allowed = kstDateTimeToUtc(nextKst.y, nextKst.m, nextKst.d, nightBanEnd, 0);
    return new Date(allowed.getTime() + randomBetween(1, 12) * 60_000);
  }

  // 00:00~07:59 — 당일 금지 종료(08:00) 이후
  const allowed = kstDateTimeToUtc(y, m, d, nightBanEnd, 0);
  return new Date(allowed.getTime() + randomBetween(1, 12) * 60_000);
}

export function computePostingScheduleCandidateWithPolicy(opts: {
  now?: Date;
  winStartHour: number;
  winEndHour: number;
  minGapMs: number;
  lastAnchor: Date | null;
  warmupDay?: number;
  /** 오늘 발행 목표(환경설정·계정별 today_target) — 스프레드 폭 결정 */
  dailyTarget?: number;
  remainingSlots?: number;
  nightBanStart?: number;
  nightBanEnd?: number;
}): Date {
  const now = opts.now ?? new Date();
  const nightBanStart = opts.nightBanStart ?? DEFAULT_NIGHT_BAN_START;
  const nightBanEnd = opts.nightBanEnd ?? DEFAULT_NIGHT_BAN_END;
  const remaining = Math.max(1, opts.remainingSlots ?? 1);
  const urgent = shouldPackPostingBeforeNightBan({
    remainingSlots: remaining,
    minGapMs: opts.minGapMs,
    nightBanStart,
    nightBanEnd,
    from: now,
  });

  const base = urgent
    ? computeEarliestPostingCandidate({
        now,
        winStartHour: opts.winStartHour,
        minGapMs: opts.minGapMs,
        lastAnchor: opts.lastAnchor,
      })
    : computePostingScheduleCandidate({
        now,
        winStartHour: opts.winStartHour,
        winEndHour: opts.winEndHour,
        minGapMs: opts.minGapMs,
        lastAnchor: opts.lastAnchor,
        warmupDay: opts.warmupDay,
        dailyTarget: opts.dailyTarget,
      });

  return clampCandidateBeforeNightBan(base, nightBanStart, nightBanEnd);
}
