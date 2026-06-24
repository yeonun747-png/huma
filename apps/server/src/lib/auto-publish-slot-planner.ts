import { avoidCrossPostingCollision } from './posting-cross-stagger.js';
import {
  countInFlightPostingPipeline,
  countTodayPostBlogCompleted,
  kstTodayStartIso,
} from './posting-daily-status.js';
import { countTodaySimilaritySkipped } from './posting-content-similarity.js';
import { formatKstDateKey, getDailyPostingTarget } from './posting-daily-target.js';
import {
  deriveActiveHourWindow,
  getActivePostingWindowHours,
  computeDynamicPublishIntervalHours,
} from './posting-interval.js';
import {
  getHumanEngineScheduleConfig,
  isNightBanActive,
  msUntilNextActiveHour,
} from './human-engine-policy.js';
import { ABSOLUTE_MIN_PUBLISH_INTERVAL_HOURS } from './posting-warmup.js';
import { randomBetween } from './utils.js';
import { supabase } from '../middleware/auth.js';

/** 자동발행 content_full 등록 — 다른 계정 트리거와만 2분 간격 (CAPTCHA 10분은 post_blog 실행 시 적용) */
export const AUTO_PUBLISH_PEER_STAGGER_MS = 2 * 60_000;

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

function kstDateTimeToUtc(y: number, m: number, d: number, hour: number, minute: number): Date {
  const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+09:00`;
  return new Date(iso);
}

function isHourInActiveWindow(hour: number, activeHours: number[], minIntensity = 0.25): boolean {
  if (activeHours.length !== 24) return hour >= 8 && hour < 22;
  return (activeHours[hour] ?? 0) >= minIntensity;
}

async function loadAccountWarmupDay(accountId: string): Promise<number> {
  const { data } = await supabase
    .from('huma_accounts')
    .select('warmup_day')
    .eq('id', accountId)
    .maybeSingle();
  return (data?.warmup_day as number | undefined) ?? 0;
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

/** 당일 자동발행 소비량 — 완료·스킵·파이프라인 */
export async function countAutoPublishConsumedToday(accountId: string): Promise<number> {
  const since = kstTodayStartIso();
  const [completed, skipped, inFlight] = await Promise.all([
    countTodayPostBlogCompleted(accountId),
    countTodaySimilaritySkipped(accountId, since),
    countInFlightPostingPipeline(accountId),
  ]);
  return completed + skipped + inFlight;
}

export interface PlanAutoPublishTriggerInput {
  accountId: string;
  plannedCount: number;
  consumedCount: number;
}

/** 다음 content_full 자동 등록 시각 — 계정 간격 + 연운·퀴즈·파나나 10분 스태거 */
export async function planNextAutoPublishTriggerAt(
  input: PlanAutoPublishTriggerInput,
  date = new Date(),
): Promise<string | null> {
  const { accountId, plannedCount, consumedCount } = input;
  if (consumedCount >= plannedCount) return null;

  const warmupDay = await loadAccountWarmupDay(accountId);
  const targetInfo = getDailyPostingTarget(accountId, date, { warmupDay });
  const dailyTarget = Math.max(1, plannedCount);

  const human = await getHumanEngineScheduleConfig();
  const activeHours = human.active_hours ?? [];
  const windowHours = getActivePostingWindowHours(activeHours);
  const minIntervalH = computeDynamicPublishIntervalHours(
    dailyTarget,
    windowHours,
    ABSOLUTE_MIN_PUBLISH_INTERVAL_HOURS,
  );
  const minGapMs = minIntervalH * 3600_000;

  const slotIndex = Math.min(consumedCount, dailyTarget - 1);
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
  const now = Date.now();

  if (candidate.getTime() <= now + 60_000) {
    candidate = new Date(now + randomBetween(2, 8) * 60_000);
  }

  const { data: lastJobs } = await supabase
    .from('huma_jobs')
    .select('created_at')
    .eq('account_id', accountId)
    .eq('job_type', 'content_full')
    .gte('created_at', kstTodayStartIso())
    .order('created_at', { ascending: false })
    .limit(1);

  const lastAt = lastJobs?.[0]?.created_at ? new Date(lastJobs[0].created_at as string) : null;
  if (lastAt && candidate.getTime() - lastAt.getTime() < minGapMs) {
    candidate = new Date(lastAt.getTime() + minGapMs + randomBetween(1, 8) * 60_000);
  }

  candidate = await ensureActivePostingWindow(candidate, activeHours);

  const peerTriggers = await listPeerAutoPublishNextSlots(accountId);
  candidate = avoidCrossPostingCollision(
    candidate,
    peerTriggers,
    AUTO_PUBLISH_PEER_STAGGER_MS,
  );

  if (candidate.getTime() <= now + 60_000) {
    candidate = avoidCrossPostingCollision(
      await ensureActivePostingWindow(new Date(now + randomBetween(2, 8) * 60_000), activeHours),
      peerTriggers,
      AUTO_PUBLISH_PEER_STAGGER_MS,
    );
  }

  return candidate.toISOString();
}

/** 다른 계정의 예정 자동발행 시각 — 겹침 방지 */
async function listPeerAutoPublishNextSlots(excludeAccountId: string): Promise<Date[]> {
  const { data } = await supabase
    .from('huma_accounts')
    .select('id, auto_publish_next_slot_at')
    .eq('auto_publish_enabled', true)
    .neq('id', excludeAccountId)
    .not('auto_publish_next_slot_at', 'is', null);

  return (data ?? [])
    .map((r) => (r.auto_publish_next_slot_at ? new Date(r.auto_publish_next_slot_at as string) : null))
    .filter((d): d is Date => d != null);
}

/** 자정 롤오버 — enabled 계정의 planned_count 갱신 */
export async function resolveAutoPublishPlannedCountForDay(
  accountId: string,
  storedDate: string | null | undefined,
  storedPlanned: number | null | undefined,
  date = new Date(),
): Promise<number> {
  const kstDate = formatKstDateKey(date);
  if (storedDate === kstDate && storedPlanned != null && storedPlanned > 0) {
    return storedPlanned;
  }
  const warmupDay = await loadAccountWarmupDay(accountId);
  return getDailyPostingTarget(accountId, date, { warmupDay }).target;
}
