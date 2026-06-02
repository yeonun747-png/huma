import { enqueueHumaJob, getScheduleDelay, type JobRecord } from '../../../lib/job-scheduler.js';
import { supabase } from '../../../middleware/auth.js';
import { enqueueJob } from '../producer.js';
import { generateAllContent } from '../../claude/content-generator.js';
import { fetchAndSummarizeUrl } from '../../claude/content-generator.js';
import {
  autoDecideWithCredits,
  resolvePlatformScheduledAt,
  selectImageModel,
  toTodayDatetime,
  type PlatformSchedule,
} from '../../claude/auto-decide.js';
import { generateImage, type ImageModel } from '../../higgsfield/image.js';
import { uniquifyImageFromUrl } from '../../image/uniquify.js';

export type ContentType = 'A' | 'B';

export interface ContentOrchestratorInput {
  workspace: string;
  title: string;
  sourceUrl: string;
  synopsis?: string;
  screenshotBase64?: string;
  content_type?: ContentType;
  content_type_auto?: boolean;
  auto_scheduled?: boolean;
  video_model?: string;
  platform_schedule?: PlatformSchedule;
  scheduled_at: string;
  repeat_rule?: string | null;
  parentJobId?: string;
}

async function pickPostingAccount(workspace: string): Promise<string | null> {
  const { data } = await supabase
    .from('huma_accounts')
    .select('id')
    .eq('workspace', workspace)
    .eq('account_type', 'posting')
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();
  return data?.id ?? null;
}

async function pickPlatformAccount(workspace: string, platform: string): Promise<string | null> {
  const { data } = await supabase
    .from('huma_platform_accounts')
    .select('id')
    .eq('workspace', workspace)
    .eq('platform', platform)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();
  return data?.id ?? null;
}

async function insertJob(row: Record<string, unknown>): Promise<JobRecord> {
  const { data, error } = await supabase.from('huma_jobs').insert(row).select().single();
  if (error || !data) throw new Error(error?.message ?? '작업 등록 실패');
  return data as JobRecord;
}

function resolveStatus(scheduledAt: string) {
  return new Date(scheduledAt).getTime() > Date.now() ? 'scheduled' : 'pending';
}

function buildVideoLinks(tiktokUrl?: string | null, instagramUrl?: string | null): string {
  const parts: string[] = [];
  if (tiktokUrl) parts.push(`\n\n▶ TikTok: ${tiktokUrl}`);
  if (instagramUrl) parts.push(`\n▶ Instagram: ${instagramUrl}`);
  return parts.join('');
}

export function extractYouTubeVideoId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname.includes('youtu.be')) return u.pathname.slice(1).split('/')[0] || null;
    const v = u.searchParams.get('v');
    if (v) return v;
    const shorts = u.pathname.match(/\/shorts\/([^/?]+)/);
    if (shorts) return shorts[1];
    const embed = u.pathname.match(/\/embed\/([^/?]+)/);
    if (embed) return embed[1];
    return u.pathname.split('/').filter(Boolean).pop() ?? null;
  } catch {
    return null;
  }
}

export function buildYouTubeEmbed(title: string, youtubeUrl?: string | null): string {
  if (!youtubeUrl) return '';
  const id = extractYouTubeVideoId(youtubeUrl);
  if (!id) return '';
  const safeTitle = title.replace(/"/g, '&quot;');
  return `\n\n<iframe width="315" height="560" src="https://www.youtube.com/embed/${id}" title="${safeTitle}" frameborder="0" allowfullscreen></iframe>`;
}

export function buildBlogVideoAppend(
  title: string,
  tiktokUrl?: string | null,
  instagramUrl?: string | null,
  youtubeUrl?: string | null,
): string {
  return buildYouTubeEmbed(title, youtubeUrl) + buildVideoLinks(tiktokUrl, instagramUrl);
}

export { buildVideoLinks };

function platformTime(
  autoScheduled: boolean,
  schedule: PlatformSchedule | undefined,
  platform: keyof PlatformSchedule,
  fallback: string,
): string {
  if (!autoScheduled || !schedule) return fallback;
  return resolvePlatformScheduledAt(platform, schedule, fallback);
}

async function enqueueVideoPipeline(
  videoQueueId: string,
  workspace: string,
  scheduledAt: string,
  title: string,
  sourceUrl: string,
  repeatRule: string | null,
) {
  const status = resolveStatus(scheduledAt);
  const videoJob = await insertJob({
    workspace,
    job_type: 'video_pipeline',
    title: `[영상] ${title}`,
    scheduled_at: scheduledAt,
    repeat_rule: repeatRule,
    status,
    retry_count: 0,
    link_url: sourceUrl,
  });

  const delay = getScheduleDelay(scheduledAt);
  const bullJob = await enqueueJob(
    {
      type: 'video_pipeline',
      humaJobId: videoJob.id,
      payload: { videoQueueId, workspace },
    },
    { delay, jobId: `huma-${videoJob.id}` },
  );

  await supabase
    .from('huma_jobs')
    .update({ status: delay ? 'scheduled' : 'pending', bull_job_id: bullJob.id ?? `huma-${videoJob.id}` })
    .eq('id', videoJob.id);
}

async function runTypeA(
  params: ContentOrchestratorInput,
  generated: Awaited<ReturnType<typeof generateAllContent>>,
  imageUrl: string,
  uniqueImageUrl: string,
  schedule?: PlatformSchedule,
) {
  const { workspace, title, sourceUrl, scheduled_at, repeat_rule, auto_scheduled = true } = params;
  const accountId = await pickPostingAccount(workspace);
  let jobsCreated = 0;

  const blogAt = platformTime(auto_scheduled, schedule, 'naver_blog', scheduled_at);
  const blogJob = await insertJob({
    workspace,
    account_id: accountId,
    job_type: 'post_blog',
    title,
    content: generated.blog_post,
    image_urls: [uniqueImageUrl],
    link_url: sourceUrl,
    hashtags: generated.hashtags,
    platform: 'naver',
    content_type: 'A',
    scheduled_at: blogAt,
    repeat_rule: repeat_rule ?? null,
    status: resolveStatus(blogAt),
    retry_count: 0,
  });
  jobsCreated += 1;
  await enqueueHumaJob(blogJob);

  const socialJobs: Array<{ type: string; platform: string; content: string; imageUrl?: string; scheduleKey: keyof PlatformSchedule }> = [
    { type: 'instagram_post', platform: 'instagram', content: generated.instagram_caption, imageUrl, scheduleKey: 'instagram' },
    { type: 'threads_post', platform: 'threads', content: generated.threads_text, imageUrl, scheduleKey: 'threads' },
    { type: 'twitter_post', platform: 'twitter', content: generated.x_text, imageUrl, scheduleKey: 'x' },
  ];

  for (const social of socialJobs) {
    const platformAccountId = await pickPlatformAccount(workspace, social.platform);
    const socialAt = platformTime(auto_scheduled, schedule, social.scheduleKey, scheduled_at);
    const socialJob = await insertJob({
      workspace,
      platform_account_id: platformAccountId,
      job_type: social.type,
      title: `[${social.platform}] ${title}`,
      content: social.content,
      image_urls: social.imageUrl ? [social.imageUrl] : undefined,
      hashtags: generated.hashtags,
      platform: social.platform,
      content_type: 'A',
      scheduled_at: socialAt,
      repeat_rule: repeat_rule ?? null,
      status: resolveStatus(socialAt),
      retry_count: 0,
    });
    jobsCreated += 1;
    await enqueueHumaJob(socialJob);
  }

  return { jobsCreated, primaryJobId: blogJob.id, video_queue_id: undefined as string | undefined };
}

async function runTypeB(
  params: ContentOrchestratorInput,
  generated: Awaited<ReturnType<typeof generateAllContent>>,
  imageUrl: string,
  uniqueImageUrl: string,
  videoModel: string,
  schedule?: PlatformSchedule,
) {
  const { workspace, title, sourceUrl, scheduled_at, repeat_rule, auto_scheduled = true } = params;
  const accountId = await pickPostingAccount(workspace);

  const blogAt = platformTime(auto_scheduled, schedule, 'naver_blog', scheduled_at);
  const threadsAt = platformTime(auto_scheduled, schedule, 'threads', scheduled_at);
  const twitterAt = platformTime(auto_scheduled, schedule, 'x', scheduled_at);
  const videoAt = platformTime(auto_scheduled, schedule, 'tiktok', scheduled_at);

  const blogJob = await insertJob({
    workspace,
    account_id: accountId,
    job_type: 'post_blog',
    title,
    content: generated.blog_post,
    image_urls: [uniqueImageUrl],
    link_url: sourceUrl,
    hashtags: generated.hashtags,
    platform: 'naver',
    content_type: 'B',
    video_model: videoModel,
    scheduled_at: blogAt,
    repeat_rule: repeat_rule ?? null,
    status: 'paused',
    retry_count: 0,
  });

  const threadsAccountId = await pickPlatformAccount(workspace, 'threads');
  const threadsJob = await insertJob({
    workspace,
    platform_account_id: threadsAccountId,
    job_type: 'threads_post',
    title: `[threads] ${title}`,
    content: generated.threads_text,
    hashtags: generated.hashtags,
    platform: 'threads',
    content_type: 'B',
    scheduled_at: threadsAt,
    repeat_rule: repeat_rule ?? null,
    status: 'paused',
    retry_count: 0,
  });

  const twitterAccountId = await pickPlatformAccount(workspace, 'twitter');
  const twitterJob = await insertJob({
    workspace,
    platform_account_id: twitterAccountId,
    job_type: 'twitter_post',
    title: `[twitter] ${title}`,
    content: generated.x_text,
    image_urls: [imageUrl],
    hashtags: generated.hashtags,
    platform: 'twitter',
    content_type: 'B',
    scheduled_at: twitterAt,
    repeat_rule: repeat_rule ?? null,
    status: 'paused',
    retry_count: 0,
  });

  const { data: videoRow, error: videoErr } = await supabase
    .from('huma_video_queue')
    .insert({
      workspace,
      job_id: params.parentJobId ?? blogJob.id,
      blog_job_id: blogJob.id,
      threads_job_id: threadsJob.id,
      twitter_job_id: twitterJob.id,
      generated_image_url: imageUrl,
      image_prompt: generated.image_prompt,
      video_prompt: generated.video_prompt,
      video_model: videoModel,
      tts_script: generated.tts_script,
      caption: generated.tiktok_caption,
      hashtags: generated.hashtags,
      upload_platforms: ['tiktok', 'instagram', 'youtube'],
      status: 'pending',
    })
    .select()
    .single();

  if (videoErr || !videoRow) throw new Error(videoErr?.message ?? '영상 큐 등록 실패');

  await enqueueVideoPipeline(videoRow.id, workspace, videoAt, title, sourceUrl, repeat_rule ?? null);

  return { jobsCreated: 4, primaryJobId: blogJob.id, video_queue_id: videoRow.id };
}

async function persistAutoDecision(
  parentJobId: string | undefined,
  decision: {
    content_type: ContentType;
    video_model: string;
    platform_schedule: PlatformSchedule;
  },
) {
  if (!parentJobId) return;
  await supabase
    .from('huma_jobs')
    .update({
      content_type: decision.content_type,
      video_model: decision.video_model,
      platform_schedule: decision.platform_schedule,
    })
    .eq('id', parentJobId);
}

export async function runContentOrchestrator(input: ContentOrchestratorInput) {
  let contentType = input.content_type;
  let videoModel = input.video_model ?? 'kling-3.0';
  let schedule = input.platform_schedule;
  const autoScheduled = input.auto_scheduled !== false;
  const shouldAutoDecide = input.content_type_auto !== false && !contentType;
  const needsSchedule = autoScheduled && !schedule;
  const needsVideoModel = !input.video_model;

  if (shouldAutoDecide || needsSchedule || needsVideoModel) {
    const urlSummary = await fetchAndSummarizeUrl(input.sourceUrl.trim());
    const decision = await autoDecideWithCredits({
      title: input.title.trim(),
      urlSummary,
      workspace: input.workspace,
    });

    if (shouldAutoDecide) contentType = decision.content_type;
    if (needsVideoModel) videoModel = decision.video_model;
    if (needsSchedule) schedule = decision.schedule;

    await persistAutoDecision(input.parentJobId, {
      content_type: contentType ?? decision.content_type,
      video_model: videoModel,
      platform_schedule: schedule ?? decision.schedule,
    });
  }

  const resolvedType = contentType ?? 'A';
  const baseScheduledAt =
    autoScheduled && schedule?.naver_blog
      ? (toTodayDatetime(schedule.naver_blog) ?? input.scheduled_at)
      : input.scheduled_at;

  const generated = await generateAllContent({
    title: input.title.trim(),
    sourceUrl: input.sourceUrl.trim(),
    synopsis: input.synopsis?.trim(),
    screenshotBase64: input.screenshotBase64,
    workspace: input.workspace,
    content_type: resolvedType,
  });

  const imageUrl = await generateImage({
    prompt: generated.image_prompt,
    model: selectImageModel(input.workspace) as ImageModel,
  });
  const uniqueImageUrl = await uniquifyImageFromUrl(imageUrl);

  const runInput = { ...input, scheduled_at: baseScheduledAt, auto_scheduled: autoScheduled };

  if (resolvedType === 'A') {
    return runTypeA(runInput, generated, imageUrl, uniqueImageUrl, schedule);
  }
  return runTypeB(runInput, generated, imageUrl, uniqueImageUrl, videoModel, schedule);
}
