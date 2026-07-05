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

function kstHourFromDate(date: Date): number {
  return Number(
    new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', hour: 'numeric', hour12: false }).format(
      date,
    ),
  );
}

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
): Date {
  if (!isKstNightBan(nightBanStart, nightBanEnd, candidate)) {
    const hour = kstHourFromDate(candidate);
    if (nightBanStart > nightBanEnd && hour >= nightBanStart) {
      const kst = kstNowParts(candidate);
      const banStartMs = kstDateTimeToUtc(kst.y, kst.m, kst.d, nightBanStart, 0).getTime();
      const bufferMs = 10 * 60_000;
      if (candidate.getTime() >= banStartMs - bufferMs) {
        return new Date(banStartMs - bufferMs);
      }
    }
    return candidate;
  }
  return candidate;
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
