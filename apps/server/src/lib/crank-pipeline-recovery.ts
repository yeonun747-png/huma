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
/**
 * 모뎀 락 TTL(120분) + 세션 상한(70분)보다 크게 잡아, 정상 장기 세션을
 * 잘못 회수해 중복 실행하는 사태를 방지한다.
 */
const STALE_RUNNING_MS = 150 * 60 * 1000;

/**
 * crash 후 running 고착 → 재등록. video_pipeline·content_full은 자체적으로
 * 길고 비싼(렌더·LLM) 작업이라 중복 실행 위험이 커서 watchdog 대상에서 제외한다.
 */
const STALE_RECOVERABLE_JOB_TYPES = ['social_crank', 'post_blog', 'cafe_new_post', 'cafe_reply'];

/** worker crash 후 running 고착 → pending 재등록 */
export async function recoverStaleRunningJobs(): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_RUNNING_MS).toISOString();
  const { data: jobs } = await supabase
    .from('huma_jobs')
    .select('*')
    .eq('status', 'running')
    .in('job_type', STALE_RECOVERABLE_JOB_TYPES)
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
