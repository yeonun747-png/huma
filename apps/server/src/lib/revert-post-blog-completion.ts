import { supabase } from '../middleware/auth.js';
import { replanAutoPublishSlot, isAutoPublishJob } from './auto-publish-state.js';
import { logOperation } from './log-emitter.js';

/** ✓ 발행 확인으로 잘못 completed 된 post_blog 되돌리기 */
export async function revertPostBlogCompletion(jobId: string): Promise<boolean> {
  const { data: job } = await supabase
    .from('huma_jobs')
    .select('id, job_type, status, account_id, workspace, platform_schedule')
    .eq('id', jobId)
    .maybeSingle();

  if (!job || job.job_type !== 'post_blog' || job.status !== 'completed') return false;

  await supabase
    .from('huma_jobs')
    .update({
      status: 'failed',
      error_message: '발행 확인 취소 (수동)',
      completed_at: null,
      result_url: null,
      started_at: null,
    })
    .eq('id', jobId);

  if (job.account_id && job.workspace && isAutoPublishJob(job.platform_schedule)) {
    await replanAutoPublishSlot(job.account_id as string, job.workspace as string).catch(() => undefined);
  }

  await logOperation({
    level: 'info',
    message: '[post_blog] 발행 확인 취소 — completed → failed',
    job_id: jobId,
    account_id: job.account_id as string | undefined,
  });

  return true;
}
