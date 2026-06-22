import { supabase } from '../middleware/auth.js';
import {
  avoidCrossPostingCollision,
  listCrossPostingOccupiedTimes,
} from './posting-cross-stagger.js';
import { deriveActiveHourWindow } from './posting-interval.js';
import {
  getHumanEngineScheduleConfig,
  isNightBanActive,
  msUntilNextActiveHour,
} from './human-engine-policy.js';
import { randomBetween } from './utils.js';
import { getDailyPostingTarget } from './posting-daily-target.js';
import { countInFlightPostingPipeline, kstTodayStartIso } from './posting-daily-status.js';
import { ABSOLUTE_MIN_PUBLISH_INTERVAL_HOURS } from './posting-warmup.js';
import {
  computeDynamicPublishIntervalHours,
  getActivePostingWindowHours,
} from './posting-interval.js';

function kstNowParts(date = new Date()): { y: number; m: number; d: number; hour: number; minute: number } {
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

function kstDateTimeToUtc(y: number, m: number, d: number, hour: number, minute: number): Date {
  const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+09:00`;
  return new Date(iso);
}

async function loadAccountWarmupDay(accountId: string): Promise<number> {
  const { data } = await supabase
    .from('huma_accounts')
    .select('warmup_day')
    .eq('id', accountId)
    .maybeSingle();
  return (data?.warmup_day as number | undefined) ?? 0;
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

function enforceMinGap(candidate: Date, minGapMs: number, anchor: Date | null): Date {
  if (!anchor) return candidate;
  const earliest = anchor.getTime() + minGapMs;
  if (candidate.getTime() >= earliest) return candidate;
  return new Date(earliest + randomBetween(1, 8) * 60_000);
}

async function ensureActivePostingWindow(candidate: Date, activeHours: number[]): Promise<Date> {
  if (await isNightBanActive()) {
    const human = await getHumanEngineScheduleConfig();
    const wait = msUntilNextActiveHour(human.active_hours ?? []);
    return new Date(Date.now() + wait + randomBetween(1, 5) * 60_000);
  }
  const hour = kstHourFromDate(candidate);
  if (isHourInActiveWindow(hour, activeHours) && candidate.getTime() > Date.now() + 60_000) {
    return candidate;
  }
  const human = await getHumanEngineScheduleConfig();
  const wait = msUntilNextActiveHour(human.active_hours ?? []);
  return new Date(Date.now() + wait + randomBetween(1, 5) * 60_000);
}

/** 계정·오늘 목표 기준 다음 post_blog scheduled_at (대략 균등 슬롯 + 편차). */
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
  const inFlight = await countInFlightPostingPipeline(accountId);
  const placedCount = completed.length + inFlight;
  const slotIndex = Math.min(placedCount, dailyTarget - 1);

  const { start: winStart, end: winEnd } = deriveActiveHourWindow(
    activeHours.length === 24 ? activeHours : [],
    0.25,
  );
  const kst = kstNowParts(date);
  const windowStartMin = winStart * 60;
  const windowEndMin = winEnd * 60;
  const windowSpanMin = Math.max(60, windowEndMin - windowStartMin);

  const slotSizeMin = windowSpanMin / dailyTarget;
  const slotStartMin = windowStartMin + slotIndex * slotSizeMin;
  const slotEndMin = Math.min(windowEndMin, slotStartMin + slotSizeMin);
  const buffer = Math.min(15, slotSizeMin * 0.12);
  const pickStart = Math.floor(slotStartMin + buffer);
  const pickEnd = Math.max(pickStart + 5, Math.floor(slotEndMin - buffer));
  const pickMin =
    pickStart + Math.floor(Math.random() * Math.max(1, pickEnd - pickStart + 1));

  const pickHour = Math.floor(pickMin / 60);
  const pickMinute = pickMin % 60;
  let candidate = kstDateTimeToUtc(kst.y, kst.m, kst.d, pickHour, pickMinute);

  const lastCompleted = latestTime(completed);
  const lastScheduled = latestTime(scheduled);
  const lastAnchor = latestTime(
    [...(lastCompleted ? [lastCompleted] : []), ...(lastScheduled ? [lastScheduled] : [])],
  );
  candidate = enforceMinGap(candidate, minGapMs, lastAnchor);

  const now = Date.now();
  if (candidate.getTime() <= now + 60_000) {
    candidate = new Date(now + randomBetween(2, 8) * 60_000);
    candidate = enforceMinGap(candidate, minGapMs, lastAnchor);
  }

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
