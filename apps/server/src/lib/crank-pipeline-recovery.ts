import { supabase } from '../middleware/auth.js';
import { humaQueue } from '../modules/queue/producer.js';
import { reconcileStaleCrankModemLocks } from '../modules/modem/allocation.js';
import { formatKstDateKey } from './crank-schedule-config.js';
import { logOperation } from './log-emitter.js';
import { getSystemPaused } from './system-pause.js';
import {
  enqueueHumaJob,
  recoverScheduledJobs,
  type JobRecord,
} from './job-scheduler.js';
import { isRetryableCrankError } from './crank-worker-defer.js';

const DAILY_CRANK_TITLE = 'C-Rank 스케줄';
const STALE_RUNNING_MS = 90 * 60 * 1000;

/** worker crash 후 running 고착 → pending 재등록 */
export async function recoverStaleRunningJobs(): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_RUNNING_MS).toISOString();
  const { data: jobs } = await supabase
    .from('huma_jobs')
    .select('*')
    .eq('status', 'running')
    .lt('started_at', cutoff);

  let n = 0;
  for (const job of jobs ?? []) {
    await supabase
      .from('huma_jobs')
      .update({
        status: 'pending',
        started_at: null,
        error_message: 'stale running — auto recover',
      })
      .eq('id', job.id);
    await enqueueHumaJob(job as JobRecord, { immediate: true });
    n++;
  }
  return n;
}

/** 당일 C-Rank 스케줄 failed 중 재시도 가능 오류 → 즉시 재등록 */
export async function recoverRetryableFailedCrankJobs(): Promise<number> {
  const dateKey = formatKstDateKey();
  const { data: jobs } = await supabase
    .from('huma_jobs')
    .select('*')
    .eq('job_type', 'social_crank')
    .eq('status', 'failed')
    .like('title', `${DAILY_CRANK_TITLE} ${dateKey}%`);

  let n = 0;
  for (const job of jobs ?? []) {
    const msg = String(job.error_message ?? '');
    if (!isRetryableCrankError(msg)) continue;

    const now = new Date().toISOString();
    await supabase
      .from('huma_jobs')
      .update({
        status: 'pending',
        scheduled_at: now,
        started_at: null,
        error_message: null,
      })
      .eq('id', job.id);
    await enqueueHumaJob(job as JobRecord, { immediate: true });
    n++;
  }
  return n;
}

/** Bull delayed/waiting인데 DB scheduled_at 이미 지남 → 즉시 재등록 */
export async function recoverOverdueBullJobs(): Promise<number> {
  const { data: jobs } = await supabase
    .from('huma_jobs')
    .select('*')
    .in('status', ['scheduled', 'pending'])
    .eq('job_type', 'social_crank')
    .not('scheduled_at', 'is', null)
    .lt('scheduled_at', new Date().toISOString());

  let n = 0;
  for (const job of jobs ?? []) {
    const record = job as JobRecord;
    const bullId = record.bull_job_id ?? `huma-${record.id}`;
    const existing = await humaQueue.getJob(bullId);
    if (!existing) continue;

    const state = await existing.getState();
    if (state !== 'delayed' && state !== 'waiting') continue;

    await enqueueHumaJob(record, { immediate: true });
    n++;
  }
  return n;
}

/** C-Rank 파이프라인 통합 복구 — 기동·재개·주기 tick */
export async function recoverCrankPipeline(): Promise<void> {
  if (getSystemPaused()) return;

  await reconcileStaleCrankModemLocks();

  const stale = await recoverStaleRunningJobs();
  const failed = await recoverRetryableFailedCrankJobs();
  const overdue = await recoverOverdueBullJobs();
  await recoverScheduledJobs();

  const total = stale + failed + overdue;
  if (total > 0) {
    await logOperation({
      level: 'info',
      message: `[crank-recover] stale=${stale} failed=${failed} overdue=${overdue}`,
    });
  }
}
