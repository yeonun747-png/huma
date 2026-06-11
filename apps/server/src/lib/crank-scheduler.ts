import type { Workspace } from '@huma/shared';
import { sortAccountsByCrankLabel } from '@huma/shared';
import { supabase } from '../middleware/auth.js';
import { getSetting } from './settings.js';
import {
  computeCrankSchedulePolicy,
  distributeCrankScheduleSlotsKst,
  formatKstDateKey,
  getKstClock,
  getKstYmd,
  proxyPortForCrankTrack,
  SESSION_DURATION_MINUTES,
} from './crank-schedule-config.js';
import { selectCrankAccountsForDailySchedule } from './crank-schedule-accounts.js';
import {
  applyLiveProbeToCrankDisplay,
  countActiveCrankModems,
  listCrankModemsForDashboard,
  resetAllMonthlyDataMb,
  resetDailyCrankCounters,
} from './crank-modems.js';
import { enqueueHumaJob, type JobRecord } from './job-scheduler.js';
import { recoverCrankPipeline } from './crank-pipeline-recovery.js';
import { logOperation } from './log-emitter.js';
import { getCrankScheduleWindow } from './human-engine-policy.js';
import { layer4RestSupabaseOr } from './account-guards.js';
import { getSystemPaused } from './system-pause.js';
import { getCrankEnabled } from './activity-control.js';

const DAILY_JOB_TITLE_PREFIX = 'C-Rank 스케줄';

let lastDailyRunKey = '';
let lastDailyCounterResetKey = '';
let lastMonthlyResetKey = '';
let lastBackoffEnsureKey = '';
let lastRecoverAt = 0;

/** KST 날짜 변경 시 일일 카운터 초기화 — 가동 중지·큐 생성과 무관 */
export async function ensureDailyCrankCountersReset(): Promise<void> {
  const dailyKey = formatKstDateKey();
  if (lastDailyCounterResetKey === dailyKey) return;
  lastDailyCounterResetKey = dailyKey;
  await resetDailyCrankCounters();
  await logOperation({
    level: 'info',
    message: `[crank-scheduler] ${dailyKey}: crank_sessions_today · crank_count_today 일일 초기화`,
  });
}

async function countActiveCrankPoolSize(): Promise<number> {
  const { count } = await supabase
    .from('huma_accounts')
    .select('id', { count: 'exact', head: true })
    .eq('account_type', 'crank')
    .eq('is_active', true)
    .or(layer4RestSupabaseOr());
  return count ?? 0;
}

export async function fetchPostingBlogUrls(workspace?: Workspace): Promise<string[]> {
  let query = supabase
    .from('huma_accounts')
    .select('blog_url')
    .eq('account_type', 'posting')
    .eq('is_active', true)
    .or(layer4RestSupabaseOr())
    .not('blog_url', 'is', null);

  if (workspace) {
    query = query.eq('workspace', workspace);
  }

  const { data } = await query;

  return (data ?? [])
    .map((r) => r.blog_url as string)
    .filter((u) => typeof u === 'string' && u.length > 0);
}

export async function selectCrankAccountsForToday(
  cycleDays: number,
  dailyAccountCount: number,
): Promise<
  Array<{
    id: string;
    name: string;
    last_crank_at: string | null;
    crank_workspace: Workspace;
    crank_label: string | null;
  }>
> {
  const { data: accounts } = await supabase
    .from('huma_accounts')
    .select('id, name, last_crank_at, crank_workspace, crank_label, layer4_rest_until')
    .eq('account_type', 'crank')
    .eq('is_active', true)
    .or(layer4RestSupabaseOr());

  const rested = (accounts ?? []).filter(
    (a) => !a.layer4_rest_until || new Date(a.layer4_rest_until) <= new Date(),
  );

  return selectCrankAccountsForDailySchedule(rested, cycleDays, dailyAccountCount);
}

/** 당일 스케줄 job이 이미 있는 계정 (완료·삭제 제외 보충용) */
async function getTodayCrankScheduledAccountIds(dateKey: string): Promise<Set<string>> {
  const { data } = await supabase
    .from('huma_jobs')
    .select('account_id')
    .eq('job_type', 'social_crank')
    .like('title', `${DAILY_JOB_TITLE_PREFIX} ${dateKey}%`)
    .not('account_id', 'is', null);

  return new Set((data ?? []).map((r) => r.account_id as string));
}

/** 매일 00:01 KST — 당일 crank 계정 큐 + 분산 scheduled_at (누락·삭제분 보충) */
export async function runDailyCrankScheduler(options?: { anchorFromNow?: boolean }): Promise<void> {
  if (getSystemPaused()) return;
  if (!getCrankEnabled()) return;

  const dateKey = formatKstDateKey();
  const alreadyScheduled = await getTodayCrankScheduledAccountIds(dateKey);

  const activeModems = await countActiveCrankModems();
  const poolSize = await countActiveCrankPoolSize();
  const policy = computeCrankSchedulePolicy(activeModems, poolSize);

  if (activeModems === 0) {
    await logOperation({
      level: 'warn',
      message: `[crank-scheduler] ${dateKey}: 가용 crank 동글 0 — 큐 생략`,
    });
    return;
  }

  const allAccounts = await selectCrankAccountsForToday(
    policy.cycleDays,
    policy.dailyAccountCount,
  );

  if (allAccounts.length === 0) {
    await logOperation({
      level: 'info',
      message: `[crank-scheduler] ${dateKey}: 주기 ${policy.cycleDays}일 — 실행 대상 계정 없음`,
    });
    return;
  }

  const accounts = allAccounts.filter((a) => !alreadyScheduled.has(a.id));
  if (accounts.length === 0) {
    return;
  }

  const scheduleWindow = await getCrankScheduleWindow();
  const scheduleSlots = distributeCrankScheduleSlotsKst(
    accounts.length,
    0,
    scheduleWindow,
    policy.activeModemCount,
    options?.anchorFromNow ? { notBefore: new Date() } : undefined,
  );

  const serviceCounts = { yeonun: 0, panana: 0, quizoasis: 0 };
  const blogUrlCache = new Map<Workspace, string[]>();
  let created = 0;

  for (let i = 0; i < accounts.length; i++) {
    const account = accounts[i];
    const slot = scheduleSlots[i];
    const crankWorkspace = account.crank_workspace ?? 'yeonun';
    serviceCounts[crankWorkspace]++;
    let ourBlogUrls = blogUrlCache.get(crankWorkspace);
    if (!ourBlogUrls) {
      ourBlogUrls = await fetchPostingBlogUrls(crankWorkspace);
      blogUrlCache.set(crankWorkspace, ourBlogUrls);
    }
    const scheduledAt = slot.at.toISOString();
    const crankTrack = slot.track;
    const preferredProxyPort = proxyPortForCrankTrack(crankTrack);
    const sessionPayload = {
      scheduledCrank: true,
      ourBlogUrls,
      sessionMinutes: SESSION_DURATION_MINUTES,
      crankTrack,
      preferredProxyPort,
    };

    const { data: job, error } = await supabase
      .from('huma_jobs')
      .insert({
        workspace: crankWorkspace,
        job_type: 'social_crank',
        account_id: account.id,
        title: `${DAILY_JOB_TITLE_PREFIX} ${dateKey} · ${account.name}`,
        content: JSON.stringify(sessionPayload),
        scheduled_at: scheduledAt,
        status: 'scheduled',
      })
      .select()
      .single();

    if (error || !job) {
      await logOperation({
        level: 'ERROR',
        message: `[crank-scheduler] job 생성 실패: ${error?.message ?? 'unknown'}`,
        account_id: account.id,
      });
      continue;
    }

    await enqueueHumaJob(job as JobRecord);
    created += 1;
  }

  if (created === 0) return;

  const anchorNote = options?.anchorFromNow ? ' · 당일보정(현재시각~)' : '';
  const backfillNote = alreadyScheduled.size > 0 ? ` · 보충(기등록 ${alreadyScheduled.size})` : '';
  await logOperation({
    level: 'info',
    message: `[crank-scheduler] ${dateKey}: 동글 ${activeModems} · 주기 ${policy.cycleDays}일 · 계정 ${created}건 (연운 ${serviceCounts.yeonun}·파나나 ${serviceCounts.panana}·퀴즈 ${serviceCounts.quizoasis}) 큐 등록${anchorNote}${backfillNote}`,
  });
}

/** 매월 1일 00:00 KST — monthly_data_mb 초기화 */
export async function runMonthlyCrankDataReset(): Promise<void> {
  await resetAllMonthlyDataMb();
  await logOperation({ level: 'info', message: '[crank-scheduler] monthly_data_mb 전체 초기화' });
}

export async function getCrankSchedulerStatus(options?: { probe?: boolean }) {
  const dateKey = formatKstDateKey();

  const dashboardRows = await listCrankModemsForDashboard();
  /** probe=1 일 때만 i7 SOCKS curl (슬롯 6·7, ~2~4초). 기본은 DB만 (~수백 ms) */
  const displayModems = options?.probe
    ? await applyLiveProbeToCrankDisplay(dashboardRows)
    : dashboardRows;

  const activeModems = displayModems.filter((m) => m.display_status === 'active').length;
  const poolSize = await countActiveCrankPoolSize();
  const policy = computeCrankSchedulePolicy(activeModems, poolSize);

  const crankCfg = await getSetting<{ planned_crank_modems?: number }>('social_crank', {});
  const plannedCrankModems = Math.max(activeModems, crankCfg.planned_crank_modems ?? 2);

  const { data: todayJobs } = await supabase
    .from('huma_jobs')
    .select('id, status, account_id, scheduled_at, completed_at, title, error_message')
    .eq('job_type', 'social_crank')
    .like('title', `${DAILY_JOB_TITLE_PREFIX} ${dateKey}%`);

  const scheduled = todayJobs ?? [];
  const todayCompleted = scheduled.filter((j) => j.status === 'completed').length;
  const todayScheduled = scheduled.length;

  const { data: crankAccounts, error: accountsError } = await supabase
    .from('huma_accounts')
    .select('id, name, crank_label, crank_workspace, last_crank_at, is_active')
    .eq('account_type', 'crank')
    ;

  if (accountsError) {
    if (/column .* does not exist/i.test(accountsError.message)) {
      throw new Error(
        'DB 마이그레이션 필요: apps/server/scripts/migrations/v3_26_social_crank_scheduler.sql',
      );
    }
    throw new Error(`C-Rank 계정 조회 실패: ${accountsError.message}`);
  }

  const accountsWithNext = sortAccountsByCrankLabel(crankAccounts ?? []).map((a) => {
    const last = a.last_crank_at as string | null;
    let nextRunAt: string | null = null;
    if (last) {
      const next = new Date(last);
      next.setUTCDate(next.getUTCDate() + policy.cycleDays);
      if (next > new Date()) nextRunAt = next.toISOString();
    }
    const todayJob = scheduled.find((j) => j.account_id === a.id);
    return {
      id: a.id,
      name: a.name,
      crank_label: (a as { crank_label?: string | null }).crank_label ?? null,
      crank_workspace: (a as { crank_workspace?: string | null }).crank_workspace ?? null,
      is_active: a.is_active,
      last_crank_at: last,
      next_run_at: todayJob?.scheduled_at ?? nextRunAt,
      today_job_status: todayJob?.status ?? null,
      today_job_error: todayJob?.error_message ?? null,
    };
  });

  const mapModemRow = (m: (typeof displayModems)[0]) => ({
    id: m.id,
    slot_number: m.slot_number,
    proxy_port: m.proxy_port,
    status: m.status,
    modem_role: m.modem_role,
    monthly_data_mb: Number(m.monthly_data_mb ?? 0),
    crank_sessions_today: m.crank_sessions_today ?? 0,
    schedule_excluded: m.display_status !== 'active',
    reserved: m.display_status === 'reserved',
    display_status: m.display_status,
    probe_ok: m.probe_ok,
    response_ms: m.response_ms ?? null,
    carrier: m.carrier,
    current_ip: m.current_ip,
  });

  return {
    date_key: dateKey,
    active_crank_modems: activeModems,
    planned_crank_modems: plannedCrankModems,
    cycle_days: policy.cycleDays,
    daily_account_target: policy.dailyAccountCount,
    max_sessions_per_modem_per_day: policy.maxSessionsPerModemPerDay,
    today_scheduled: todayScheduled,
    today_completed: todayCompleted,
    session_duration_minutes: SESSION_DURATION_MINUTES,
    modems: displayModems.map(mapModemRow),
    accounts: accountsWithNext,
  };
}

function tickCrankSchedulerClock() {
  ensureDailyCrankCountersReset().catch((err) =>
    console.error('[crank-scheduler] daily counter reset:', err),
  );

  if (Date.now() - lastRecoverAt > 60_000) {
    lastRecoverAt = Date.now();
    recoverCrankPipeline().catch((err) =>
      console.error('[crank-recover] tick:', err),
    );
  }

  const { hour, minute, day } = getKstClock();
  const ymd = getKstYmd();
  const monthKey = `${ymd.year}-${ymd.month}`;

  if (day === 1 && hour === 0 && minute === 0) {
    if (lastMonthlyResetKey !== monthKey) {
      lastMonthlyResetKey = monthKey;
      runMonthlyCrankDataReset().catch((err) =>
        console.error('[crank-scheduler] monthly reset:', err),
      );
    }
  }

  if (hour === 0 && minute === 1) {
    const dailyKey = formatKstDateKey();
    if (lastDailyRunKey !== dailyKey) {
      lastDailyRunKey = dailyKey;
      runDailyCrankScheduler().catch((err) =>
        console.error('[crank-scheduler] daily:', err),
      );
    }
  }

  // 동글 복구·중지 해제 후 당일 큐 재시도 (매시 :00·:30 KST, 1회)
  if (minute === 0 || minute === 30) {
    const backoffKey = `${formatKstDateKey()}-${hour}:${minute}`;
    if (lastBackoffEnsureKey !== backoffKey) {
      lastBackoffEnsureKey = backoffKey;
      ensureTodayCrankQueue().catch((err) =>
        console.error('[crank-scheduler] backoff ensure:', err),
      );
      recoverCrankPipeline().catch((err) =>
        console.error('[crank-scheduler] recover:', err),
      );
    }
  }
}

/** 서버 기동·동글 복구 시 당일 누락 계정 큐 보충 */
export async function ensureTodayCrankQueue(): Promise<void> {
  if (getSystemPaused()) return;
  if (!getCrankEnabled()) return;
  if ((await countActiveCrankModems()) === 0) return;
  await runDailyCrankScheduler({ anchorFromNow: true });
}

export function startCrankScheduler(): void {
  ensureDailyCrankCountersReset().catch((err) =>
    console.error('[crank-scheduler] startup counter reset:', err),
  );
  setInterval(tickCrankSchedulerClock, 30_000);
  tickCrankSchedulerClock();
  ensureTodayCrankQueue().catch((err) =>
    console.error('[crank-scheduler] ensure today:', err),
  );
}
