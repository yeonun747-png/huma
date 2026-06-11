import { supabase } from '../middleware/auth.js';
import { logOperation } from './log-emitter.js';
import { enqueueHumaJob, type JobRecord } from './job-scheduler.js';

/** VNC CAPTCHA 해결 후 post_blog·cafe 발행 자동화 재개 */
export async function resumePostingAfterCaptcha(jobId: string, accountId: string): Promise<void> {
  const { data: job } = await supabase.from('huma_jobs').select('*').eq('id', jobId).maybeSingle();
  if (!job) throw new Error('JOB_NOT_FOUND');

  await supabase
    .from('huma_accounts')
    .update({ is_active: true, layer4_rest_until: null })
    .eq('id', accountId);

  const prevPs = (job.platform_schedule as Record<string, unknown> | null) ?? {};
  const platform_schedule = {
    ...prevPs,
    _resumeAfterCaptcha: true,
  };

  const now = new Date().toISOString();
  await supabase
    .from('huma_jobs')
    .update({
      status: 'pending',
      error_message: null,
      started_at: null,
      completed_at: null,
      result_url: null,
      scheduled_at: now,
      advance_requested_at: now,
      platform_schedule,
    })
    .eq('id', jobId);

  await enqueueHumaJob({ ...(job as JobRecord), platform_schedule }, { immediate: true });

  await logOperation({
    level: 'info',
    message: 'CAPTCHA 해결 — 발행 자동화 재개 예약',
    job_id: jobId,
    account_id: accountId,
  });
}
