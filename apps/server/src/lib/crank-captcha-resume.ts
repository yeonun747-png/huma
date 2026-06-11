import { supabase } from '../middleware/auth.js';
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

/** CAPTCHA hold 해제 후 블로그 방문·공감·댓글 루프를 이어서 실행 */
export async function resumeSocialCrankAfterCaptcha(
  jobId: string,
  accountId: string,
  preferredProxyPort?: number,
): Promise<void> {
  const { data: job } = await supabase.from('huma_jobs').select('*').eq('id', jobId).maybeSingle();
  if (!job) throw new Error('JOB_NOT_FOUND');

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
