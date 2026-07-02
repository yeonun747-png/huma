import {
  avoidDongleAwareScheduleCollision,
  CROSS_DONGLE_AUTO_PUBLISH_STAGGER_MS,
  loadPostingAccountProxyPort,
  SAME_DONGLE_STAGGER_MS,
  type PeerScheduleSlot,
} from './posting-cross-stagger.js';
import {
  countInFlightPostingPipeline,
  countTodayPostBlogCompleted,
  kstTodayStartIso,
} from './posting-daily-status.js';
import { countTodaySimilaritySkipped } from './posting-content-similarity.js';
import { formatKstDateKey, getDailyPostingTarget } from './posting-daily-target.js';
import {
  computeDynamicPublishIntervalHours,
  computePostingScheduleCandidate,
  deriveActiveHourWindow,
  getActivePostingWindowHours,
} from './posting-interval.js';
import {
  getHumanEngineScheduleConfig,
  isNightBanActive,
  msUntilNextActiveHour,
} from './human-engine-policy.js';
import { DEFAULT_NIGHT_BAN_END, DEFAULT_NIGHT_BAN_START, msUntilNightBanEnd } from './crank-schedule-config.js';
import { ABSOLUTE_MIN_PUBLISH_INTERVAL_HOURS } from './posting-warmup.js';
import { getPostingWarmupDay } from './posting-warmup-day.js';
import { randomBetween } from './utils.js';
import { supabase } from '../middleware/auth.js';

/** @deprecated 동글-aware stagger 사용 */
export const AUTO_PUBLISH_PEER_STAGGER_MS = 2 * 60_000;

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

  const { start: winStart, end: winEnd } = deriveActiveHourWindow(
    activeHours.length === 24 ? activeHours : [],
    0.25,
  );

  const { data: lastJobs } = await supabase
    .from('huma_jobs')
    .select('created_at')
    .eq('account_id', accountId)
    .eq('job_type', 'content_full')
    .gte('created_at', kstTodayStartIso())
    .order('created_at', { ascending: false })
    .limit(1);

  const lastAt = lastJobs?.[0]?.created_at ? new Date(lastJobs[0].created_at as string) : null;

  let candidate = computePostingScheduleCandidate({
    now: date,
    winStartHour: winStart,
    winEndHour: winEnd,
    minGapMs,
    lastAnchor: lastAt,
    warmupDay,
  });
  const now = Date.now();

  candidate = await ensureActivePostingWindow(candidate, activeHours);

  const accountProxyPort = await loadPostingAccountProxyPort(accountId);
  const peerTriggers = await listPeerAutoPublishNextSlots(accountId);
  candidate = avoidDongleAwareScheduleCollision(candidate, peerTriggers, accountProxyPort, {
    sameDongleMs: SAME_DONGLE_STAGGER_MS,
    crossDongleMs: CROSS_DONGLE_AUTO_PUBLISH_STAGGER_MS,
  });

  if (candidate.getTime() <= now + 60_000) {
    candidate = avoidDongleAwareScheduleCollision(
      await ensureActivePostingWindow(new Date(now + randomBetween(2, 8) * 60_000), activeHours),
      peerTriggers,
      accountProxyPort,
      {
        sameDongleMs: SAME_DONGLE_STAGGER_MS,
        crossDongleMs: CROSS_DONGLE_AUTO_PUBLISH_STAGGER_MS,
      },
    );
  }

  return candidate.toISOString();
}

/** 다른 계정의 예정 자동발행 시각 — 동글별 겹침 방지 */
async function listPeerAutoPublishNextSlots(excludeAccountId: string): Promise<PeerScheduleSlot[]> {
  const { data } = await supabase
    .from('huma_accounts')
    .select('id, proxy_port, auto_publish_next_slot_at')
    .eq('auto_publish_enabled', true)
    .neq('id', excludeAccountId)
    .not('auto_publish_next_slot_at', 'is', null);

  return (data ?? [])
    .map((r) => {
      const at = r.auto_publish_next_slot_at
        ? new Date(r.auto_publish_next_slot_at as string)
        : null;
      if (!at) return null;
      const port = r.proxy_port;
      return {
        at,
        proxyPort: typeof port === 'number' ? port : null,
      } satisfies PeerScheduleSlot;
    })
    .filter((d): d is PeerScheduleSlot => d != null);
}

/** 자정 롤오버 — enabled 계정의 planned_count 갱신 */
export async function resolveAutoPublishPlannedCountForDay(
  accountId: string,
  storedDate: string | null | undefined,
  storedPlanned: number | null | undefined,
  date = new Date(),
): Promise<number> {
  const kstDate = formatKstDateKey(date);
  const warmupDay = await loadAccountWarmupDay(accountId);
  const dailyTarget = getDailyPostingTarget(accountId, date, { warmupDay }).target;
  if (storedDate === kstDate && storedPlanned != null && storedPlanned > 0) {
    return Math.min(storedPlanned, dailyTarget);
  }
  return dailyTarget;
}
