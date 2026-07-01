import { supabase } from '../middleware/auth.js';
import type { JobRecord } from './job-scheduler.js';
import { scheduleRepeatIfNeeded } from './repeat-scheduler.js';
import { purgePostBlogStorageMedia } from './cleanup-post-blog-storage.js';
import { recordPublishedPost } from '../modules/blog-check/post-record.js';
import {
  PUBLISH_SCHEDULED_AT_KEY,
  RECONCILE_PUBLISH_AT_KEY,
  RECONCILED_FROM_FAILED_KEY,
  resolveFinalizePublishAtIso,
} from './post-blog-publish-day.js';
import { maybeIncrementWarmupDay } from './posting-warmup-day.js';

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
    (opts?.reconciledFromFailed ? null : resolveFinalizePublishAtIso(job));
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
      : {
          ...prevPs,
          [PUBLISH_SCHEDULED_AT_KEY]: publishedAt,
        };

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
      platform_schedule,
      bull_job_id: null,
      advance_requested_at: null,
    })
    .eq('id', jobId);

  if (job.account_id) {
    const accountId = job.account_id as string;
    await recordPublishedPost({
      accountId,
      resultUrl: url,
      title: job.title as string | null,
      content: job.content as string | null,
      linkUrl: job.link_url as string | null,
      imageUrls: job.image_urls as string[] | null,
      publishedAt: completedAt,
      workspace: job.workspace as string | null,
      hasVideo: job.content_type === 'B',
    });
    await maybeIncrementWarmupDay(accountId);
  }

  await scheduleRepeatIfNeeded(job as JobRecord);
  return true;
}
