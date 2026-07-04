import { supabase } from '../middleware/auth.js';
import { removeBullJob } from './job-scheduler.js';
import { isCaptchaDrillJob } from '@huma/shared';
import { cancelCaptchaHold } from '../modules/watcher/captcha-hold.js';
import {
  isPostingPipelineJobType,
  reconcilePostingAfterJobRemoval,
  type PostingReconcileTarget,
} from './reconcile-posting-after-job-removal.js';

const VIDEO_JOB_FK_COLS = ['blog_job_id', 'threads_job_id', 'twitter_job_id'] as const;

type JobDeleteRow = {
  id: string;
  job_type: string;
  result_url?: string | null;
  bull_job_id?: string | null;
  title?: string | null;
  platform_schedule?: Record<string, unknown> | null;
  status?: string | null;
};

/** content_full(스케줄) ↔ post_blog(Claude 발행) 연동 삭제 */
async function relatedJobIds(job: JobDeleteRow): Promise<string[]> {
  const out: string[] = [];

  if (job.job_type === 'content_full' && job.result_url?.trim()) {
    out.push(job.result_url.trim());
  }

  const { data: parents } = await supabase
    .from('huma_jobs')
    .select('id')
    .eq('result_url', job.id)
    .eq('job_type', 'content_full');
  for (const row of parents ?? []) out.push(row.id);

  const { data: vqRows } = await supabase
    .from('huma_video_queue')
    .select('job_id, blog_job_id, threads_job_id, twitter_job_id')
    .or(
      `blog_job_id.eq.${job.id},job_id.eq.${job.id},threads_job_id.eq.${job.id},twitter_job_id.eq.${job.id}`,
    );

  for (const vq of vqRows ?? []) {
    if (vq.job_id && vq.job_id !== job.id) out.push(vq.job_id);
    if (vq.blog_job_id && vq.blog_job_id !== job.id) out.push(vq.blog_job_id);
    if (vq.threads_job_id) out.push(vq.threads_job_id);
    if (vq.twitter_job_id) out.push(vq.twitter_job_id);
  }

  return [...new Set(out)];
}

async function expandJobDeleteSet(seedIds: string[]): Promise<string[]> {
  const toDelete = new Set<string>();
  const queue = [...new Set(seedIds.filter(Boolean))];

  while (queue.length > 0) {
    const cur = queue.pop()!;
    if (toDelete.has(cur)) continue;

    const { data: job, error } = await supabase
      .from('huma_jobs')
      .select('id, job_type, result_url')
      .eq('id', cur)
      .maybeSingle();

    if (error || !job) continue;
    toDelete.add(cur);

    const related = await relatedJobIds(job as JobDeleteRow);
    for (const id of related) {
      if (!toDelete.has(id)) queue.push(id);
    }
  }

  return [...toDelete];
}

async function deleteSingleJobRecord(
  existing: JobDeleteRow,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const id = existing.id;

  if (isCaptchaDrillJob(existing) || existing.status === 'awaiting_captcha') {
    await cancelCaptchaHold(id);
  }

  const { error: vqRowErr } = await supabase.from('huma_video_queue').delete().eq('job_id', id);
  if (vqRowErr) return { ok: false, error: vqRowErr.message };

  for (const col of VIDEO_JOB_FK_COLS) {
    const { error } = await supabase.from('huma_video_queue').update({ [col]: null }).eq(col, id);
    if (error) return { ok: false, error: error.message };
  }

  const { error: logsErr } = await supabase.from('huma_logs').delete().eq('job_id', id);
  if (logsErr) return { ok: false, error: logsErr.message };

  await removeBullJob(existing.bull_job_id);

  const { error: jobErr } = await supabase.from('huma_jobs').delete().eq('id', id);
  if (jobErr) return { ok: false, error: jobErr.message };

  return { ok: true };
}

async function collectPostingReconcileTargets(ids: string[]): Promise<PostingReconcileTarget[]> {
  const targets: PostingReconcileTarget[] = [];
  const seen = new Set<string>();

  for (const id of ids) {
    const { data: job } = await supabase
      .from('huma_jobs')
      .select('account_id, workspace, job_type')
      .eq('id', id)
      .maybeSingle();

    if (!job?.account_id || !job.workspace || !isPostingPipelineJobType(job.job_type)) continue;

    const key = `${job.account_id}:${job.workspace}`;
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push({ accountId: job.account_id as string, workspace: job.workspace as string });
  }

  return targets;
}

/** huma_logs·video_queue FK 정리 후 job 삭제 (연동 content_full·post_blog 포함) */
export async function deleteJobById(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const ids = await expandJobDeleteSet([id]);
  if (ids.length === 0) return { ok: false, error: '작업 없음' };

  const reconcileTargets = await collectPostingReconcileTargets(ids);

  for (const jobId of ids) {
    const { data: existing, error: selectErr } = await supabase
      .from('huma_jobs')
      .select('id, bull_job_id, title, platform_schedule, status, job_type, result_url')
      .eq('id', jobId)
      .maybeSingle();

    if (selectErr) return { ok: false, error: selectErr.message };
    if (!existing) continue;

    const result = await deleteSingleJobRecord(existing as JobDeleteRow);
    if (!result.ok) return result;
  }

  await reconcilePostingAfterJobRemoval(reconcileTargets);
  return { ok: true };
}

export async function deleteJobsByIds(ids: string[]): Promise<{ deleted: number; failed: number; errors: string[] }> {
  const expanded = await expandJobDeleteSet(ids);
  const reconcileTargets = await collectPostingReconcileTargets(expanded);
  let deleted = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const id of expanded) {
    const { data: existing, error: selectErr } = await supabase
      .from('huma_jobs')
      .select('id, bull_job_id, title, platform_schedule, status, job_type, result_url')
      .eq('id', id)
      .maybeSingle();

    if (selectErr) {
      failed += 1;
      errors.push(selectErr.message);
      continue;
    }
    if (!existing) continue;

    const result = await deleteSingleJobRecord(existing as JobDeleteRow);
    if (result.ok) {
      deleted += 1;
    } else {
      failed += 1;
      errors.push(result.error);
    }
  }

  if (deleted > 0) {
    await reconcilePostingAfterJobRemoval(reconcileTargets);
  }

  return { deleted, failed, errors: [...new Set(errors)] };
}
