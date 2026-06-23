import { supabase } from '../middleware/auth.js';
import type { JobRecord } from './job-scheduler.js';
import { scheduleRepeatIfNeeded } from './repeat-scheduler.js';
import { purgePostBlogStorageMedia } from './cleanup-post-blog-storage.js';
import { recordPublishedPost } from '../modules/blog-check/post-record.js';
import {
  RECONCILE_PUBLISH_AT_KEY,
  RECONCILED_FROM_FAILED_KEY,
  resolveWorkerPublishAtIso,
} from './post-blog-publish-day.js';

export type FinalizePostBlogOpts = {
  /** 네이버 실제 발행 시각 — reconcile 시 필수 */
  publishedAt?: string | null;
  /** ✓ 발행 확인으로 failed → completed 전환 */
  reconciledFromFailed?: boolean;
};

/** post_blog 발행 완료 — huma_jobs·posts·반복 스케줄 */
export async function finalizePostBlogJob(
  jobId: string,
  resultUrl: string,
  opts?: FinalizePostBlogOpts,
): Promise<boolean> {
  const url = resultUrl.trim();
  if (!url) return false;

  const { data: job } = await supabase.from('huma_jobs').select('*').eq('id', jobId).maybeSingle();
  if (!job || job.job_type !== 'post_blog') return false;
  if (job.status === 'completed' && job.result_url?.trim()) return true;

  const publishedAt =
    opts?.publishedAt?.trim() ||
    (opts?.reconciledFromFailed ? null : resolveWorkerPublishAtIso(job) || new Date().toISOString());
  if (opts?.reconciledFromFailed && !publishedAt) {
    throw new Error('발행 시각을 확인할 수 없어 완료 처리할 수 없습니다');
  }

  const completedAt = publishedAt ?? new Date().toISOString();

  const prevPs = (job.platform_schedule as Record<string, unknown> | null) ?? {};
  const platform_schedule =
    opts?.reconciledFromFailed && publishedAt
      ? {
          ...prevPs,
          [RECONCILED_FROM_FAILED_KEY]: true,
          [RECONCILE_PUBLISH_AT_KEY]: publishedAt,
        }
      : job.platform_schedule;

  await purgePostBlogStorageMedia(job.image_urls as string[] | null, {
    jobId,
    accountId: job.account_id as string | undefined,
  });

  await supabase
    .from('huma_jobs')
    .update({
      status: 'completed',
      result_url: url,
      completed_at: completedAt,
      error_message: null,
      started_at: job.started_at ?? completedAt,
      image_urls: null,
      ...(opts?.reconciledFromFailed ? { platform_schedule } : {}),
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
      publishedAt: completedAt,
      workspace: job.workspace as string | null,
      hasVideo: job.content_type === 'B',
    });
  }

  await scheduleRepeatIfNeeded(job as JobRecord);
  return true;
}
