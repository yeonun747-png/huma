import { supabase } from '../middleware/auth.js';
import {
  avoidDongleAwareScheduleCollision,
  CROSS_POSTING_STAGGER_MS,
  listCrossPostingOccupiedTimes,
  loadPostingAccountProxyPort,
  SAME_DONGLE_STAGGER_MS,
} from './posting-cross-stagger.js';
import {
  computeDynamicPublishIntervalHours,
  getActivePostingWindowHours,
} from './posting-interval.js';
import {
  computePostingScheduleCandidateWithPolicy,
  clampCandidateBeforeNightBan,
  resolvePostingDayWindow,
} from './posting-schedule-window.js';
import {
  getHumanEngineScheduleConfig,
  isNightBanActive,
  msUntilNextActiveHour,
} from './human-engine-policy.js';
import { DEFAULT_NIGHT_BAN_END, DEFAULT_NIGHT_BAN_START, msUntilNightBanEnd } from './crank-schedule-config.js';
import { randomBetween } from './utils.js';
import { getDailyPostingTarget } from './posting-daily-target.js';
import { kstTodayStartIso } from './posting-daily-status.js';
import { ABSOLUTE_MIN_PUBLISH_INTERVAL_HOURS } from './posting-warmup.js';
import { getPostingWarmupDay } from './posting-warmup-day.js';

function kstHourFromDate(date: Date): number {
  return Number(
    new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', hour: 'numeric', hour12: false }).format(
      date,
    ),
  );
}

function isHourInActiveWindow(hour: number, activeHours: number[], minIntensity = 0.25): boolean {
  if (activeHours.length !== 24) return hour >= 8 && hour < 22;
  return (activeHours[hour] ?? 0) >= minIntensity;
}

async function loadAccountWarmupDay(accountId: string): Promise<number> {
  return getPostingWarmupDay(accountId);
}

async function listTodayPostBlogTimes(accountId: string): Promise<{
  completed: Date[];
  scheduled: Date[];
}> {
  const since = kstTodayStartIso();
  const { data } = await supabase
    .from('huma_jobs')
    .select('status, completed_at, scheduled_at, started_at')
    .eq('account_id', accountId)
    .eq('job_type', 'post_blog')
    .in('status', ['completed', 'pending', 'scheduled', 'running', 'awaiting_captcha'])
    .or(`completed_at.gte.${since},scheduled_at.gte.${since},started_at.gte.${since}`);

  const completed: Date[] = [];
  const scheduled: Date[] = [];

  for (const row of data ?? []) {
    if (row.status === 'completed' && row.completed_at) {
      completed.push(new Date(row.completed_at as string));
    } else if (row.status === 'running' || row.status === 'awaiting_captcha') {
      const at = row.started_at ? new Date(row.started_at as string) : new Date();
      scheduled.push(at);
    } else if (row.scheduled_at) {
      scheduled.push(new Date(row.scheduled_at as string));
    }
  }

  return { completed, scheduled };
}

function latestTime(times: Date[]): Date | null {
  if (!times.length) return null;
  return times.reduce((a, b) => (a.getTime() > b.getTime() ? a : b));
}

async function ensureActivePostingWindow(candidate: Date, activeHours: number[]): Promise<Date> {
  const human = await getHumanEngineScheduleConfig();
  if (await isNightBanActive()) {
    const wait = msUntilNightBanEnd(human.night_ban_start ?? DEFAULT_NIGHT_BAN_START, human.night_ban_end ?? DEFAULT_NIGHT_BAN_END);
    if (wait > 0) {
      return new Date(Date.now() + wait + randomBetween(1, 5) * 60_000);
    }
  }
  const hour = kstHourFromDate(candidate);
  if (isHourInActiveWindow(hour, activeHours) && candidate.getTime() > Date.now() + 60_000) {
    return candidate;
  }
  const wait = msUntilNextActiveHour(human.active_hours ?? []);
  return new Date(Date.now() + wait + randomBetween(1, 5) * 60_000);
}

/** 계정·오늘 목표 기준 다음 post_blog scheduled_at — warmup_day에 따라 활성창 내 분산. */
export async function planNextPostBlogScheduledAt(accountId: string, date = new Date()): Promise<string> {
  const warmupDay = await loadAccountWarmupDay(accountId);
  const targetInfo = getDailyPostingTarget(accountId, date, { warmupDay });
  const dailyTarget = Math.max(1, targetInfo.target);

  const human = await getHumanEngineScheduleConfig();
  const activeHours = human.active_hours ?? [];
  const nightBanStart = human.night_ban_start ?? DEFAULT_NIGHT_BAN_START;
  const nightBanEnd = human.night_ban_end ?? DEFAULT_NIGHT_BAN_END;
  const windowHours = getActivePostingWindowHours(activeHours);
  const minIntervalH = computeDynamicPublishIntervalHours(
    dailyTarget,
    windowHours,
    ABSOLUTE_MIN_PUBLISH_INTERVAL_HOURS,
  );
  const minGapMs = minIntervalH * 3600_000;

  const { completed, scheduled } = await listTodayPostBlogTimes(accountId);

  const { start: winStart, end: winEnd } = resolvePostingDayWindow(activeHours, nightBanStart);

  const lastCompleted = latestTime(completed);
  const lastScheduled = latestTime(scheduled);
  const lastAnchor = latestTime(
    [...(lastCompleted ? [lastCompleted] : []), ...(lastScheduled ? [lastScheduled] : [])],
  );

  const slotsUsed = completed.length + scheduled.length;
  const remainingSlots = Math.max(1, dailyTarget - slotsUsed);

  let candidate = computePostingScheduleCandidateWithPolicy({
    now: date,
    winStartHour: winStart,
    winEndHour: winEnd,
    minGapMs,
    lastAnchor,
    warmupDay,
    dailyTarget,
    remainingSlots,
    nightBanStart,
    nightBanEnd,
  });

  const now = Date.now();

  candidate = await ensureActivePostingWindow(candidate, activeHours);

  const accountProxyPort = await loadPostingAccountProxyPort(accountId);
  const crossOccupied = await listCrossPostingOccupiedTimes(accountId);
  candidate = avoidDongleAwareScheduleCollision(candidate, crossOccupied, accountProxyPort, {
    sameDongleMs: SAME_DONGLE_STAGGER_MS,
    crossDongleMs: CROSS_POSTING_STAGGER_MS,
  });

  if (candidate.getTime() <= now + 60_000) {
    candidate = avoidDongleAwareScheduleCollision(
      await ensureActivePostingWindow(new Date(now + randomBetween(2, 8) * 60_000), activeHours),
      crossOccupied,
      accountProxyPort,
      {
        sameDongleMs: SAME_DONGLE_STAGGER_MS,
        crossDongleMs: CROSS_POSTING_STAGGER_MS,
      },
    );
  }

  candidate = clampCandidateBeforeNightBan(candidate, nightBanStart, nightBanEnd, new Date(now));

  return candidate.toISOString();
}
