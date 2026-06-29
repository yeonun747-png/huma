import { humaQueue, enqueueJob } from '../modules/queue/producer.js';
import { supabase } from '../middleware/auth.js';
import { resolveBlogLinkUrl } from './blog-link.js';
import { getSystemPaused } from './system-pause.js';

export interface JobRecord {
  id: string;
  job_type: string;
  account_id?: string;
  platform_account_id?: string;
  workspace?: string;
  title?: string;
  content?: string;
  image_urls?: string[];
  link_url?: string;
  hashtags?: string[];
  platform?: string;
  content_type?: string;
  result_url?: string;
  scheduled_at?: string;
  repeat_rule?: string | null;
  bull_job_id?: string;
  platform_schedule?: Record<string, unknown> | null;
  video_path?: string | null;
  advance_requested_at?: string | null;
}

export function getScheduleDelay(scheduledAt?: string | null): number | undefined {
  if (!scheduledAt) return undefined;
  const delay = new Date(scheduledAt).getTime() - Date.now();
  return delay > 0 ? delay : undefined;
}

/** 발행 예약 시각이 도래했으면 true — 워커가 휴먼 엔진 재예약으로 밀지 않도록 */
export function isScheduledPublishDue(scheduledAt?: string | null): boolean {
  if (!scheduledAt) return false;
  return getScheduleDelay(scheduledAt) === undefined;
}

export async function resolveHumaJobScheduledAt(humaJobId?: string): Promise<string | null> {
  if (!humaJobId) return null;
  const { data } = await supabase
    .from('huma_jobs')
    .select('scheduled_at')
    .eq('id', humaJobId)
    .maybeSingle();
  return data?.scheduled_at ?? null;
}

export function resolveJobStatus(scheduledAt?: string | null): 'scheduled' | 'pending' {
  return getScheduleDelay(scheduledAt) ? 'scheduled' : 'pending';
}

function parseSocialCrankContent(content?: string | null): Record<string, unknown> {
  if (!content?.trim()) return {};
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    if (parsed && typeof parsed === 'object') return parsed;
  } catch {
    /* plain text content */
  }
  return {};
}

export function buildEnqueuePayload(job: JobRecord) {
  const crankExtras =
    job.job_type === 'social_crank' ? parseSocialCrankContent(job.content) : {};

  const stripBodyLink = ['threads_post', 'twitter_post', 'post_blog'].includes(job.job_type);
  const linkUrl = stripBodyLink
    ? undefined
    : resolveBlogLinkUrl(job.workspace ?? 'yeonun', job.link_url, job.link_url);

  return {
    type: job.job_type,
    accountId: job.account_id,
    platformAccountId: job.platform_account_id,
    humaJobId: job.id,
    advanceRequested: Boolean(job.advance_requested_at),
    payload: {
      title: job.title,
      content: job.content,
      text: job.content,
      imageUrl: job.image_urls?.[0],
      imageUrls: job.image_urls,
      linkUrl,
      contentType: job.content_type,
      parentPostId:
        job.job_type === 'threads_reply' || job.job_type === 'twitter_reply'
          ? job.result_url
          : undefined,
      workspace: job.workspace,
      videoPath: ['threads_reply', 'twitter_reply'].includes(job.job_type) ? undefined : job.result_url,
      caption: job.content ?? job.title,
      hashtags: job.hashtags,
      // post_blog가 카테고리·발행 옵션을 읽을 수 있도록 전달 (이전엔 누락되어 blog_category 미적용)
      platform_schedule: job.platform_schedule ?? undefined,
      // post_blog 동영상 툴바 삽입용 파일 경로 (video_pipeline 산출물)
      video_path: job.video_path ?? undefined,
      ...crankExtras,
    },
  };
}

export async function removeBullJob(bullJobId?: string | null) {
  if (!bullJobId) return;
  try {
    const job = await humaQueue.getJob(bullJobId);
    if (job) await job.remove();
  } catch {
    // Redis/Bull 정리 실패해도 DB 삭제는 진행
  }
}

export async function enqueueHumaJob(
  job: JobRecord,
  opts?: { immediate?: boolean; jobId?: string; priority?: number },
) {
  const delay = opts?.immediate ? undefined : getScheduleDelay(job.scheduled_at);
  const status = delay ? 'scheduled' : 'pending';
  const advancePriority = job.advance_requested_at ? 1_000_000 : undefined;

  await removeBullJob(job.bull_job_id);
  await removeBullJob(`huma-${job.id}`);

  const bullJob = await enqueueJob(buildEnqueuePayload(job), {
    delay,
    jobId: opts?.jobId ?? `huma-${job.id}`,
    priority: opts?.priority ?? advancePriority,
  });

  await supabase
    .from('huma_jobs')
    .update({ status, bull_job_id: bullJob.id ?? `huma-${job.id}` })
    .eq('id', job.id);

  return { status, bullJobId: bullJob.id };
}

export async function recoverScheduledJobs() {
  if (getSystemPaused()) return;

  const { data: jobs } = await supabase
    .from('huma_jobs')
    .select('*')
    .in('status', ['scheduled', 'pending'])
    .not('scheduled_at', 'is', null);

  for (const job of jobs ?? []) {
    const record = job as JobRecord;
    const bullId = record.bull_job_id ?? `huma-${record.id}`;
    const overdue = !getScheduleDelay(record.scheduled_at);
    const existing = await humaQueue.getJob(bullId);

    if (!existing) {
      await enqueueHumaJob(record, { immediate: overdue });
      continue;
    }

    const state = await existing.getState();
    if (state === 'failed' || state === 'completed') {
      await enqueueHumaJob(record, { immediate: overdue });
      continue;
    }

    if (overdue && (state === 'delayed' || state === 'waiting')) {
      await enqueueHumaJob(record, { immediate: true });
    }
  }
}
