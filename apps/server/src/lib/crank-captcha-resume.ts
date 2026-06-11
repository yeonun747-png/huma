import { supabase } from '../middleware/auth.js';
import { logOperation } from './log-emitter.js';
import { enqueueHumaJob, type JobRecord } from './job-scheduler.js';

function parseSocialCrankContent(content?: string | null): Record<string, unknown> {
  if (!content?.trim()) return {};
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    if (parsed && typeof parsed === 'object') return parsed;
  } catch {
    /* plain text */
  }
  return {};
}

/** VNC에서 캡차 해결 후 활동 재개 — Layer4 pause로 꺼진 계정을 다시 켠다 */
async function reactivateAccountAfterCaptchaHold(accountId: string, jobId: string): Promise<void> {
  await supabase
    .from('huma_accounts')
    .update({
      is_active: true,
      layer4_rest_until: null,
    })
    .eq('id', accountId);

  await logOperation({
    level: 'info',
    message: 'CAPTCHA hold 해제 — 계정 재활성 (활동 재개)',
    job_id: jobId,
    account_id: accountId,
  });
}

/** CAPTCHA hold 해제 후 블로그 방문·공감·댓글 루프를 이어서 실행 */
export async function resumeSocialCrankAfterCaptcha(
  jobId: string,
  accountId: string,
  preferredProxyPort?: number,
): Promise<void> {
  const { data: job } = await supabase.from('huma_jobs').select('*').eq('id', jobId).maybeSingle();
  if (!job) throw new Error('JOB_NOT_FOUND');

  await reactivateAccountAfterCaptchaHold(accountId, jobId);

  const content = parseSocialCrankContent(job.content);
  const updatedContent = JSON.stringify({
    ...content,
    resumeAfterCaptcha: true,
    ...(preferredProxyPort != null ? { preferredProxyPort } : {}),
  });

  await supabase
    .from('huma_jobs')
    .update({
      status: 'pending',
      error_message: null,
      started_at: null,
      completed_at: null,
      content: updatedContent,
    })
    .eq('id', jobId);

  await enqueueHumaJob({ ...(job as JobRecord), content: updatedContent }, { immediate: true });
}
