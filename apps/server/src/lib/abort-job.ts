import { supabase } from '../middleware/auth.js';
import { redisConnection } from '../modules/queue/producer.js';
import { releaseModemLocks } from '../modules/modem/allocation.js';
import { forceReleaseAccount } from './account-lock.js';
import { logOperation } from './log-emitter.js';
import { removeBullJob } from './job-scheduler.js';
import { cancelCaptchaHold, getCaptchaHold } from '../modules/watcher/captcha-hold.js';
import { deleteJobById } from './delete-job.js';
import {
  isPostingPipelineJobType,
  reconcilePostingAfterJobRemoval,
} from './reconcile-posting-after-job-removal.js';

function postingLockKey(port: number) {
  return `modem_lock:posting:${port}`;
}

function crankLockKey(port: number) {
  return `modem_lock:${port}`;
}

async function forceReleaseModemForAccount(accountId: string): Promise<void> {
  const { data } = await supabase
    .from('huma_accounts')
    .select('proxy_port, account_type')
    .eq('id', accountId)
    .maybeSingle();
  const port = data?.proxy_port;
  if (!port) return;

  if (data?.account_type === 'posting') {
    await redisConnection.del(postingLockKey(port));
  } else {
    await redisConnection.del(crankLockKey(port));
    await releaseModemLocks(port, 'crank').catch(() => {});
  }

  await supabase
    .from('huma_modems')
    .update({ status: 'idle' })
    .eq('proxy_port', port)
    .eq('status', 'busy');
}

type StuckJobRow = {
  id: string;
  status: string;
  bull_job_id?: string | null;
  account_id?: string | null;
};

/** Bull·CAPTCHA hold·계정·동글 락 해제 — DB status는 변경하지 않음 */
export async function releaseStuckJobResources(job: StuckJobRow): Promise<void> {
  if (getCaptchaHold(job.id) || job.status === 'awaiting_captcha') {
    await cancelCaptchaHold(job.id).catch(() => {});
  }

  await removeBullJob(job.bull_job_id);
  await removeBullJob(`huma-${job.id}`);

  if (job.account_id) {
    await forceReleaseAccount(job.account_id);
    await forceReleaseModemForAccount(job.account_id);
  }

  await supabase
    .from('huma_jobs')
    .update({ bull_job_id: null, advance_requested_at: null })
    .eq('id', job.id);
}

/**
 * 고착 LIVE/running — Bull·CAPTCHA hold·계정·동글 락 해제 후 failed 처리 (또는 삭제).
 */
export async function abortHumaJobById(
  id: string,
  opts?: { deleteAfter?: boolean; reason?: string },
): Promise<{ ok: true; deleted: boolean } | { ok: false; error: string }> {
  const { data: job, error: selectErr } = await supabase
    .from('huma_jobs')
    .select('id, status, bull_job_id, account_id, workspace, job_type, title')
    .eq('id', id)
    .maybeSingle();

  if (selectErr) return { ok: false, error: selectErr.message };
  if (!job) return { ok: false, error: '작업 없음' };

  if (!['running', 'awaiting_captcha'].includes(String(job.status))) {
    return { ok: false, error: 'LIVE·CAPTCHA 대기 작업만 강제 중단할 수 있습니다' };
  }

  const reason = opts?.reason?.trim() || 'JOB_ABORTED_BY_USER';

  await releaseStuckJobResources(job);

  if (opts?.deleteAfter) {
    const del = await deleteJobById(id);
    if (!del.ok) return del;
    await logOperation({
      level: 'warn',
      message: `[job] LIVE 강제 중단·삭제: ${job.title ?? job.job_type}`,
      job_id: id,
      account_id: job.account_id ?? undefined,
    });
    return { ok: true, deleted: true };
  }

  const { error: updateErr } = await supabase
    .from('huma_jobs')
    .update({
      status: 'failed',
      error_message: reason,
      started_at: null,
      completed_at: new Date().toISOString(),
    })
    .eq('id', id);

  if (updateErr) return { ok: false, error: updateErr.message };

  await logOperation({
    level: 'warn',
    message: `[job] LIVE 강제 중단: ${job.title ?? job.job_type} (${reason})`,
    job_id: id,
    account_id: job.account_id ?? undefined,
  });

  if (
    job.account_id &&
    job.workspace &&
    isPostingPipelineJobType(String(job.job_type))
  ) {
    await reconcilePostingAfterJobRemoval([
      { accountId: job.account_id as string, workspace: job.workspace as string },
    ]);
  }

  return { ok: true, deleted: false };
}
