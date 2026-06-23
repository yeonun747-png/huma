import { supabase } from '../middleware/auth.js';
import type { JobRecord } from './job-scheduler.js';
import { scheduleRepeatIfNeeded } from './repeat-scheduler.js';
import { purgePostBlogStorageMedia } from './cleanup-post-blog-storage.js';
import { recordPublishedPost } from '../modules/blog-check/post-record.js';

/** post_blog 발행 완료 — huma_jobs·posts·반복 스케줄 */
export async function finalizePostBlogJob(jobId: string, resultUrl: string): Promise<boolean> {
  const url = resultUrl.trim();
  if (!url) return false;

  const { data: job } = await supabase.from('huma_jobs').select('*').eq('id', jobId).maybeSingle();
  if (!job || job.job_type !== 'post_blog') return false;
  if (job.status === 'completed' && job.result_url?.trim()) return true;

  await purgePostBlogStorageMedia(job.image_urls as string[] | null, {
    jobId,
    accountId: job.account_id as string | undefined,
  });

  await supabase
    .from('huma_jobs')
    .update({
      status: 'completed',
      result_url: url,
      completed_at: new Date().toISOString(),
      error_message: null,
      started_at: job.started_at ?? new Date().toISOString(),
      image_urls: null,
    })
    .eq('id', jobId);

  if (job.account_id) {
    await recordPublishedPost({
      accountId: job.account_id as string,
      resultUrl: url,
      title: job.title as string | null,
      content: job.content as string | null,
      linkUrl: job.link_url as string | null,
      imageUrls: job.image_urls as string[] | null,
      publishedAt: new Date().toISOString(),
      workspace: job.workspace as string | null,
      hasVideo: job.content_type === 'B',
    });
  }

  await scheduleRepeatIfNeeded(job as JobRecord);
  return true;
}
