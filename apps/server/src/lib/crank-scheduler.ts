import { supabase } from '../middleware/auth.js';
import { CRANK_POOL_WORKSPACE } from './crank-pool.js';
import {
  computeCrankSchedulePolicy,
  distributeCrankStartTimesKst,
  formatKstDateKey,
  getKstClock,
  getKstYmd,
} from './crank-schedule-config.js';
import {
  countActiveCrankModems,
  listCrankModemsForDashboard,
  resetAllMonthlyDataMb,
  resetDailyCrankCounters,
  syncCrankModemProbeStatus,
} from './crank-modems.js';
import { getSetting } from './settings.js';
import { enqueueHumaJob, type JobRecord } from './job-scheduler.js';
import { logOperation } from './log-emitter.js';
import { getCrankScheduleWindow } from './human-engine-policy.js';

const DAILY_JOB_TITLE_PREFIX = 'C-Rank 스케줄';

let lastDailyRunKey = '';
let lastMonthlyResetKey = '';

export async function fetchPostingBlogUrls(): Promise<string[]> {
  const { data } = await supabase
    .from('huma_accounts')
    .select('blog_url')
    .eq('account_type', 'posting')
    .eq('is_active', true)
    .not('blog_url', 'is', null);

  return (data ?? [])
    .map((r) => r.blog_url as string)
    .filter((u) => typeof u === 'string' && u.length > 0);
}

export async function selectCrankAccountsForToday(
  cycleDays: number,
  dailyAccountCount: number,
): Promise<Array<{ id: string; name: string; last_crank_at: string | null }>> {
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - cycleDays);

  const { data: accounts } = await supabase
    .from('huma_accounts')
    .select('id, name, last_crank_at')
    .eq('account_type', 'crank')
    .eq('is_active', true)
    .order('last_crank_at', { ascending: true, nullsFirst: true });

  const eligible = (accounts ?? []).filter((a) => {
    if (!a.last_crank_at) return true;
    return new Date(a.last_crank_at) < cutoff;
  });

  return eligible.slice(0, dailyAccountCount) as Array<{
    id: string;
    name: string;
    last_crank_at: string | null;
  }>;
}

async function hasDailyScheduleJobs(dateKey: string): Promise<boolean> {
  const { count } = await supabase
    .from('huma_jobs')
    .select('id', { count: 'exact', head: true })
    .eq('job_type', 'social_crank')
    .like('title', `${DAILY_JOB_TITLE_PREFIX} ${dateKey}%`);

  return (count ?? 0) > 0;
}

/** 매일 00:01 KST — 당일 crank 계정 큐 + 분산 scheduled_at */
export async function runDailyCrankScheduler(): Promise<void> {
  const dateKey = formatKstDateKey();
  if (await hasDailyScheduleJobs(dateKey)) {
    return;
  }

  await resetDailyCrankCounters();

  const activeModems = await countActiveCrankModems();
  const policy = computeCrankSchedulePolicy(activeModems);

  if (activeModems === 0) {
    await logOperation({
      level: 'warn',
      message: `[crank-scheduler] ${dateKey}: 가용 crank 동글 0 — 큐 생략`,
    });
    return;
  }

  const accounts = await selectCrankAccountsForToday(
    policy.cycleDays,
    policy.dailyAccountCount,
  );

  if (accounts.length === 0) {
    await logOperation({
      level: 'info',
      message: `[crank-scheduler] ${dateKey}: 주기 ${policy.cycleDays}일 — 실행 대상 계정 없음`,
    });
    return;
  }

  const ourBlogUrls = await fetchPostingBlogUrls();
  const scheduleWindow = await getCrankScheduleWindow();
  const startTimes = distributeCrankStartTimesKst(accounts.length, 0, scheduleWindow);

  for (let i = 0; i < accounts.length; i++) {
    const account = accounts[i];
    const scheduledAt = startTimes[i].toISOString();
    const sessionPayload = {
      scheduledCrank: true,
      ourBlogUrls,
      sessionMinutes: 60,
    };

    const { data: job, error } = await supabase
      .from('huma_jobs')
      .insert({
        workspace: CRANK_POOL_WORKSPACE,
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
  }

  await logOperation({
    level: 'info',
    message: `[crank-scheduler] ${dateKey}: 동글 ${activeModems} · 주기 ${policy.cycleDays}일 · 계정 ${accounts.length}건 큐 등록`,
  });
}

/** 매월 1일 00:00 KST — monthly_data_mb 초기화 */
export async function runMonthlyCrankDataReset(): Promise<void> {
  await resetAllMonthlyDataMb();
  await logOperation({ level: 'info', message: '[crank-scheduler] monthly_data_mb 전체 초기화' });
}

export async function getCrankSchedulerStatus() {
  const activeModems = await countActiveCrankModems();
  const policy = computeCrankSchedulePolicy(activeModems);
  const dateKey = formatKstDateKey();

  const crankCfg = await getSetting<{ planned_crank_modems?: number }>('social_crank', {});
  const plannedCrankModems = Math.max(activeModems, crankCfg.planned_crank_modems ?? 5);

  await syncCrankModemProbeStatus([6, 7]);
  const displayModems = await listCrankModemsForDashboard();

  const { data: todayJobs } = await supabase
    .from('huma_jobs')
    .select('id, status, account_id, scheduled_at, completed_at, title')
    .eq('job_type', 'social_crank')
    .like('title', `${DAILY_JOB_TITLE_PREFIX} ${dateKey}%`);

  const scheduled = todayJobs ?? [];
  const todayCompleted = scheduled.filter((j) => j.status === 'completed').length;
  const todayScheduled = scheduled.length;

  const { data: crankAccounts } = await supabase
    .from('huma_accounts')
    .select('id, name, last_crank_at, is_active')
    .eq('account_type', 'crank')
    .order('name');

  const accountsWithNext = (crankAccounts ?? []).map((a) => {
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
      is_active: a.is_active,
      last_crank_at: last,
      next_run_at: todayJob?.scheduled_at ?? nextRunAt,
      today_job_status: todayJob?.status ?? null,
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
    session_duration_minutes: 60,
    modems: displayModems.map(mapModemRow),
    accounts: accountsWithNext,
  };
}

function tickCrankSchedulerClock() {
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
}

/** 서버 기동 시 오늘 큐가 없으면 보정 생성 */
export async function ensureTodayCrankQueue(): Promise<void> {
  const dateKey = formatKstDateKey();
  if (!(await hasDailyScheduleJobs(dateKey))) {
    await runDailyCrankScheduler();
  }
}

export function startCrankScheduler(): void {
  setInterval(tickCrankSchedulerClock, 30_000);
  tickCrankSchedulerClock();
  ensureTodayCrankQueue().catch((err) =>
    console.error('[crank-scheduler] ensure today:', err),
  );
}
