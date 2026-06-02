import { supabase } from '../middleware/auth.js';
import { enqueueHumaJob, type JobRecord } from './job-scheduler.js';

/** ㉝㉞㉟ — X·Threads reply에는 TikTok만 (YouTube 금지) */
export function sanitizeSocialReplyLink(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) throw new Error('reply 링크가 비어 있습니다');
  if (/youtube\.com|youtu\.be/i.test(trimmed)) {
    throw new Error('YouTube 링크는 X·Threads reply에 사용 불가 — TikTok URL만 허용');
  }
  if (!/tiktok\.com/i.test(trimmed)) {
    throw new Error('X·Threads reply 링크는 TikTok URL만 허용');
  }
  return trimmed;
}

export async function createPausedSocialReplyJob(params: {
  jobType: 'threads_reply' | 'twitter_reply';
  workspace: string;
  platformAccountId?: string | null;
  parentJobId: string;
  tiktokUrl: string;
  title?: string;
}) {
  const link = sanitizeSocialReplyLink(params.tiktokUrl);
  const platform = params.jobType === 'threads_reply' ? 'threads' : 'twitter';

  const { error } = await supabase.from('huma_jobs').insert({
    workspace: params.workspace,
    platform_account_id: params.platformAccountId ?? null,
    job_type: params.jobType,
    title: params.title ?? `[${platform} reply]`,
    content: params.parentJobId,
    link_url: link,
    platform,
    status: 'paused',
    retry_count: 0,
  });

  if (error) throw new Error(error.message);
}

/** 본문 발행 완료 후 첫 댓글(reply) job 활성화 */
export async function activatePendingSocialReplies(parentHumaJobId: string, platformPostId: string) {
  const { data: replies } = await supabase
    .from('huma_jobs')
    .select('*')
    .in('job_type', ['threads_reply', 'twitter_reply'])
    .eq('content', parentHumaJobId)
    .eq('status', 'paused');

  for (const reply of replies ?? []) {
    await supabase
      .from('huma_jobs')
      .update({ status: 'pending', result_url: platformPostId })
      .eq('id', reply.id);

    const { data: updated } = await supabase.from('huma_jobs').select('*').eq('id', reply.id).single();
    if (updated) await enqueueHumaJob(updated as JobRecord, { immediate: true });
  }
}
