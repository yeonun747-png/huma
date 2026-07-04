import { supabase } from '../middleware/auth.js';
import { replanAutoPublishSlot, isAutoPublishJob } from './auto-publish-state.js';
import { logOperation } from './log-emitter.js';
import {
  isPublishedTodayKst,
  isReconciledFromFailed,
  RECONCILE_PUBLISH_AT_KEY,
  resolveJobPublishedAtIso,
} from './post-blog-publish-day.js';
import { scheduleWorkspaceQueueStatsRefresh } from './workspace-queue-stats.js';

/**
 * ✓ 발행 확인 오적용만 되돌림 — 오늘 실제 발행·워커 정상 완료는 취소 불가.
 */
export async function revertPostBlogCompletion(jobId: string): Promise<boolean> {
  const { data: job } = await supabase
    .from('huma_jobs')
    .select('id, job_type, status, account_id, workspace, platform_schedule, result_url, completed_at')
    .eq('id', jobId)
    .maybeSingle();

  if (!job || job.job_type !== 'post_blog' || job.status !== 'completed') return false;

  if (!isReconciledFromFailed(job.platform_schedule)) {
    throw new Error('워커가 정상 완료한 발행은 취소할 수 없습니다');
  }

  const publishedAt = resolveJobPublishedAtIso(job);
  if (isPublishedTodayKst(publishedAt)) {
    throw new Error('오늘 실제 발행된 글은 취소할 수 없습니다 — ✓ 처리가 맞습니다');
  }

  const prevPs = (job.platform_schedule as Record<string, unknown> | null) ?? {};
  const { [RECONCILE_PUBLISH_AT_KEY]: _a, _reconciled_from_failed: _b, ...restPs } = prevPs;

  await supabase
    .from('huma_jobs')
    .update({
      status: 'failed',
      error_message: '발행 확인 취소 (오적용)',
      completed_at: null,
      result_url: null,
      started_at: null,
      platform_schedule: Object.keys(restPs).length ? restPs : null,
    })
    .eq('id', jobId);

  if (job.account_id && job.workspace && isAutoPublishJob(job.platform_schedule)) {
    await replanAutoPublishSlot(job.account_id as string, job.workspace as string).catch(() => undefined);
  }

  await logOperation({
    level: 'info',
    message: '[post_blog] 잘못된 발행 확인 취소 — completed → failed',
    job_id: jobId,
    account_id: job.account_id as string | undefined,
  });

  scheduleWorkspaceQueueStatsRefresh(job.workspace as string | null);
  return true;
}
