import { supabase } from '../middleware/auth.js';
import {
  avoidCrossPostingCollision,
  listCrossPostingOccupiedTimes,
} from './posting-cross-stagger.js';
import {
  computeDynamicPublishIntervalHours,
  computeEarliestPostingCandidate,
  deriveActiveHourWindow,
  getActivePostingWindowHours,
} from './posting-interval.js';
import {
  getHumanEngineScheduleConfig,
  isNightBanActive,
  msUntilNextActiveHour,
} from './human-engine-policy.js';
import { msUntilNightBanEnd } from './crank-schedule-config.js';
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
    const wait = msUntilNightBanEnd(human.night_ban_start ?? 0, human.night_ban_end ?? 7);
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

/** 계정·오늘 목표 기준 다음 post_blog scheduled_at — 가능한 한 이른 시각 우선. */
export async function planNextPostBlogScheduledAt(accountId: string, date = new Date()): Promise<string> {
  const warmupDay = await loadAccountWarmupDay(accountId);
  const targetInfo = getDailyPostingTarget(accountId, date, { warmupDay });
  const dailyTarget = Math.max(1, targetInfo.target);

  const human = await getHumanEngineScheduleConfig();
  const activeHours = human.active_hours ?? [];
  const windowHours = getActivePostingWindowHours(activeHours);
  const minIntervalH = computeDynamicPublishIntervalHours(
    dailyTarget,
    windowHours,
    ABSOLUTE_MIN_PUBLISH_INTERVAL_HOURS,
  );
  const minGapMs = minIntervalH * 3600_000;

  const { completed, scheduled } = await listTodayPostBlogTimes(accountId);

  const { start: winStart } = deriveActiveHourWindow(
    activeHours.length === 24 ? activeHours : [],
    0.25,
  );

  const lastCompleted = latestTime(completed);
  const lastScheduled = latestTime(scheduled);
  const lastAnchor = latestTime(
    [...(lastCompleted ? [lastCompleted] : []), ...(lastScheduled ? [lastScheduled] : [])],
  );

  let candidate = computeEarliestPostingCandidate({
    now: date,
    winStartHour: winStart,
    minGapMs,
    lastAnchor,
  });

  const now = Date.now();

  candidate = await ensureActivePostingWindow(candidate, activeHours);

  const crossOccupied = await listCrossPostingOccupiedTimes(accountId);
  candidate = avoidCrossPostingCollision(candidate, crossOccupied);

  if (candidate.getTime() <= now + 60_000) {
    candidate = avoidCrossPostingCollision(
      await ensureActivePostingWindow(new Date(now + randomBetween(2, 8) * 60_000), activeHours),
      crossOccupied,
    );
  }

  return candidate.toISOString();
}
