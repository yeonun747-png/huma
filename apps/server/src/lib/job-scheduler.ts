import { humaQueue, enqueueJob } from '../modules/queue/producer.js';
import { supabase } from '../middleware/auth.js';

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
}

export function getScheduleDelay(scheduledAt?: string | null): number | undefined {
  if (!scheduledAt) return undefined;
  const delay = new Date(scheduledAt).getTime() - Date.now();
  return delay > 0 ? delay : undefined;
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

  const stripBodyLink = ['threads_post', 'twitter_post'].includes(job.job_type);

  return {
    type: job.job_type,
    accountId: job.account_id,
    platformAccountId: job.platform_account_id,
    humaJobId: job.id,
    payload: {
      title: job.title,
      content: job.content,
      text: job.content,
      imageUrl: job.image_urls?.[0],
      imageUrls: job.image_urls,
      linkUrl: stripBodyLink ? undefined : job.link_url,
      parentPostId:
        job.job_type === 'threads_reply' || job.job_type === 'twitter_reply'
          ? job.result_url
          : undefined,
      workspace: job.workspace,
      videoPath: ['threads_reply', 'twitter_reply'].includes(job.job_type) ? undefined : job.result_url,
      caption: job.content ?? job.title,
      hashtags: job.hashtags,
      ...crankExtras,
    },
  };
}

export async function removeBullJob(bullJobId?: string | null) {
  if (!bullJobId) return;
  const job = await humaQueue.getJob(bullJobId);
  if (job) await job.remove();
}

export async function enqueueHumaJob(job: JobRecord, opts?: { immediate?: boolean }) {
  const delay = opts?.immediate ? undefined : getScheduleDelay(job.scheduled_at);
  const status = delay ? 'scheduled' : 'pending';

  await removeBullJob(job.bull_job_id);

  const bullJob = await enqueueJob(buildEnqueuePayload(job), {
    delay,
    jobId: `huma-${job.id}`,
  });

  await supabase
    .from('huma_jobs')
    .update({ status, bull_job_id: bullJob.id ?? `huma-${job.id}` })
    .eq('id', job.id);

  return { status, bullJobId: bullJob.id };
}

export async function recoverScheduledJobs() {
  const { data: jobs } = await supabase
    .from('huma_jobs')
    .select('*')
    .in('status', ['scheduled', 'pending'])
    .not('scheduled_at', 'is', null);

  for (const job of jobs ?? []) {
    const bullId = job.bull_job_id ?? `huma-${job.id}`;
    const existing = await humaQueue.getJob(bullId);
    if (!existing) {
      await enqueueHumaJob(job as JobRecord);
    }
  }
}
