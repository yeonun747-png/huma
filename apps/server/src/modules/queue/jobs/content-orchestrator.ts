import { enqueueHumaJob, getScheduleDelay, type JobRecord } from '../../../lib/job-scheduler.js';
import { layer4RestSupabaseOr } from '../../../lib/account-guards.js';
import { normalizeBlogLinkUrl } from '../../../lib/blog-link.js';
import { supabase } from '../../../middleware/auth.js';
import { enqueueJob } from '../producer.js';
import { generateAllContent, type ContentGenerationOutput } from '../../claude/content-generator.js';
import { fetchAndSummarizeUrl } from '../../claude/content-generator.js';
import {
  autoDecideWithCredits,
  resolveNaverBlogScheduledAt,
  resolvePlatformScheduledAt,
  selectImageModel,
  type PlatformSchedule,
} from '../../claude/auto-decide.js';
import { generateImage, type ImageModel } from '../../higgsfield/image.js';
import { getPipelineModelSettings } from '../../../lib/pipeline-settings.js';
import { resolveBlogWritingPersona } from '../../../lib/blog-writing-persona.js';
import {
  patchJobGenerationProgress,
  patchJobPreviewProgress,
  type PreviewStep,
} from '../../claude/content-preview.js';
import { isNaverBlogOnlyMode } from '../../../lib/activity-control.js';

export type ContentType = 'A' | 'B';

export function isDryRunJob(platformSchedule: unknown): boolean {
  if (!platformSchedule || typeof platformSchedule !== 'object') return false;
  return (platformSchedule as Record<string, unknown>)._dry_run === true;
}

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

async function pickPostingAccount(workspace: string): Promise<{ id: string; persona?: Record<string, unknown> } | null> {
  const { data } = await supabase
    .from('huma_accounts')
    .select('id, persona')
    .eq('workspace', workspace)
    .eq('account_type', 'posting')
    .eq('is_active', true)
    .or(layer4RestSupabaseOr())
    .limit(1)
    .maybeSingle();
  return data ? { id: data.id as string, persona: data.persona as Record<string, unknown> | undefined } : null;
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
  if (platform === 'naver_blog') {
    return resolveNaverBlogScheduledAt(schedule.naver_blog, fallback);
  }
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
  schedule?: PlatformSchedule,
) {
  const { workspace, title, sourceUrl, scheduled_at, repeat_rule, auto_scheduled = true } = params;
  const account = await pickPostingAccount(workspace);
  const accountId = account?.id ?? null;
  let jobsCreated = 0;

  const blogLink = normalizeBlogLinkUrl(workspace, sourceUrl);
  const blogAt = platformTime(auto_scheduled, schedule, 'naver_blog', scheduled_at);
  const blogJob = await insertJob({
    workspace,
    account_id: accountId,
    job_type: 'post_blog',
    // 네이버 검색 노출용 SEO 제목 우선, 없으면 운영자 제목
    title: generated.seo_title?.trim() || title,
    content: generated.blog_post,
    // 발행 직전 post-blog에서 1회 uniquify (로컬 tmp는 휘발 → 내구성 있는 https URL 저장)
    image_urls: [imageUrl],
    link_url: blogLink,
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

  if (!isNaverBlogOnlyMode()) {
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
  }

  return { jobsCreated, primaryJobId: blogJob.id, video_queue_id: undefined as string | undefined };
}

async function runTypeB(
  params: ContentOrchestratorInput,
  generated: Awaited<ReturnType<typeof generateAllContent>>,
  imageUrl: string,
  videoModel: string,
  schedule?: PlatformSchedule,
) {
  const { workspace, title, sourceUrl, scheduled_at, repeat_rule, auto_scheduled = true } = params;
  const account = await pickPostingAccount(workspace);
  const accountId = account?.id ?? null;

  const blogLink = normalizeBlogLinkUrl(workspace, sourceUrl);
  const blogAt = platformTime(auto_scheduled, schedule, 'naver_blog', scheduled_at);
  const threadsAt = platformTime(auto_scheduled, schedule, 'threads', scheduled_at);
  const twitterAt = platformTime(auto_scheduled, schedule, 'x', scheduled_at);
  const videoAt = platformTime(auto_scheduled, schedule, 'tiktok', scheduled_at);

  const blogJob = await insertJob({
    workspace,
    account_id: accountId,
    job_type: 'post_blog',
    // 네이버 검색 노출용 SEO 제목 우선, 없으면 운영자 제목
    title: generated.seo_title?.trim() || title,
    content: generated.blog_post,
    // 발행 직전 post-blog에서 1회 uniquify (내구성 있는 https URL 저장)
    image_urls: [imageUrl],
    link_url: blogLink,
    hashtags: generated.hashtags,
    platform: 'naver',
    content_type: 'B',
    video_model: videoModel,
    scheduled_at: blogAt,
    repeat_rule: repeat_rule ?? null,
    status: isNaverBlogOnlyMode() ? resolveStatus(blogAt) : 'paused',
    retry_count: 0,
  });

  if (isNaverBlogOnlyMode()) {
    await enqueueHumaJob(blogJob);
    return { jobsCreated: 1, primaryJobId: blogJob.id, video_queue_id: undefined as string | undefined };
  }

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

  const pipelineModels = await getPipelineModelSettings(workspace);

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
      ...(pipelineModels.imageModel ? { image_model: pipelineModels.imageModel } : {}),
      video_model: pipelineModels.videoModel,
      duration_sec: pipelineModels.durationSec,
      ...(generated.tts_script?.trim()
        ? { tts_script: generated.tts_script.trim() }
        : {}),
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
  const { data: job } = await supabase
    .from('huma_jobs')
    .select('platform_schedule')
    .eq('id', parentJobId)
    .maybeSingle();
  const wasDryRun = isDryRunJob(job?.platform_schedule);
  const platformSchedule = wasDryRun
    ? { ...decision.platform_schedule, _dry_run: true }
    : decision.platform_schedule;

  await supabase
    .from('huma_jobs')
    .update({
      content_type: decision.content_type,
      video_model: decision.video_model,
      platform_schedule: platformSchedule,
    })
    .eq('id', parentJobId);
}

export async function runContentOrchestrator(input: ContentOrchestratorInput) {
  let contentType = input.content_type;
  let videoModel = input.video_model ?? 'kling-3.0';
  let schedule = input.platform_schedule;
  const autoScheduled = input.auto_scheduled !== false;
  const dryRun = isDryRunJob(schedule);
  const shouldAutoDecide = input.content_type_auto !== false && !contentType;
  const needsSchedule = autoScheduled && !schedule && !dryRun;
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
    autoScheduled && schedule?.naver_blog && !dryRun
      ? resolveNaverBlogScheduledAt(schedule.naver_blog, input.scheduled_at)
      : input.scheduled_at;

  const postingAccount = await pickPostingAccount(input.workspace);
  const blogWritingPersona = resolveBlogWritingPersona(
    input.workspace,
    postingAccount?.persona ?? null,
  );

  const previewSteps: PreviewStep[] = [
    { id: 'claude', label: 'Claude — 블로그 글·해시태그 작성', status: 'running' },
    { id: 'imagen', label: 'Imagen — 대표 이미지 생성', status: 'pending' },
  ];
  if (input.parentJobId) {
    const patch = dryRun ? patchJobPreviewProgress : patchJobGenerationProgress;
    await patch(input.parentJobId, previewSteps);
  }

  const claudeStart = Date.now();
  const generated = await generateAllContent({
    title: input.title.trim(),
    sourceUrl: input.sourceUrl.trim(),
    synopsis: input.synopsis?.trim(),
    screenshotBase64: input.screenshotBase64,
    workspace: input.workspace,
    content_type: resolvedType,
    blogWritingPersona,
  });

  previewSteps[0] = {
    ...previewSteps[0]!,
    status: 'ok',
    ms: Date.now() - claudeStart,
    detail: `${generated.blog_post.length}자`,
  };
  previewSteps[1] = { ...previewSteps[1]!, status: 'running' };
  if (input.parentJobId) {
    const patch = dryRun ? patchJobPreviewProgress : patchJobGenerationProgress;
    await patch(input.parentJobId, previewSteps, {
      blog_post_length: generated.blog_post.length,
    });
  }
  if (dryRun && input.parentJobId) {
    await supabase
      .from('huma_jobs')
      .update({
        content: generated.blog_post,
        link_url: normalizeBlogLinkUrl(input.workspace, input.sourceUrl),
        hashtags: generated.hashtags,
      })
      .eq('id', input.parentJobId);
  }

  const imagenStart = Date.now();
  const imageModel = selectImageModel(input.workspace);
  const imageUrl = await generateImage({
    prompt: generated.image_prompt,
    model: imageModel as ImageModel,
  });

  previewSteps[1] = {
    ...previewSteps[1]!,
    status: 'ok',
    ms: Date.now() - imagenStart,
    detail: imageUrl,
  };

  if (input.parentJobId && !dryRun) {
    await patchJobGenerationProgress(input.parentJobId, previewSteps, {
      image_model: imageModel,
      image_url: imageUrl,
    });
  }

  if (dryRun && input.parentJobId) {
    await patchJobPreviewProgress(input.parentJobId, previewSteps, {
      image_model: imageModel,
      image_url: imageUrl,
    });
    const { data: currentJob } = await supabase
      .from('huma_jobs')
      .select('platform_schedule')
      .eq('id', input.parentJobId)
      .maybeSingle();
    const prevPs = (currentJob?.platform_schedule as Record<string, unknown> | null) ?? {};
    await supabase
      .from('huma_jobs')
      .update({
        image_urls: [imageUrl],
        platform_schedule: {
          ...prevPs,
          ...(schedule ?? {}),
          _dry_run: true,
          _preview: {
            steps: previewSteps,
            image_model: imageModel,
            image_prompt: generated.image_prompt,
            image_url: imageUrl,
            generated: {
              blog_post: generated.blog_post,
              tiktok_caption: generated.tiktok_caption,
              instagram_caption: generated.instagram_caption,
              threads_text: generated.threads_text,
              x_text: generated.x_text,
              image_prompt: generated.image_prompt,
              video_prompt: generated.video_prompt,
              hashtags: generated.hashtags,
              blog_post_target_chars: generated.blog_post_target_chars,
              blog_post_target_min_chars: generated.blog_post_target_min_chars,
              blog_post_target_max_chars: generated.blog_post_target_max_chars,
            },
            updated_at: new Date().toISOString(),
          },
        },
      })
      .eq('id', input.parentJobId);

    return {
      jobsCreated: 0,
      primaryJobId: input.parentJobId,
      video_queue_id: undefined as string | undefined,
      dry_run: true as const,
      generated,
      image_url: imageUrl,
    };
  }

  const runInput = { ...input, scheduled_at: baseScheduledAt, auto_scheduled: autoScheduled };

  if (resolvedType === 'A') {
    return runTypeA(runInput, generated, imageUrl, schedule);
  }
  return runTypeB(runInput, generated, imageUrl, videoModel, schedule);
}

type PreviewGeneratedSnapshot = Pick<
  ContentGenerationOutput,
  | 'blog_post'
  | 'tiktok_caption'
  | 'instagram_caption'
  | 'threads_text'
  | 'x_text'
  | 'image_prompt'
  | 'video_prompt'
  | 'hashtags'
  | 'blog_post_target_chars'
  | 'blog_post_target_min_chars'
  | 'blog_post_target_max_chars'
>;

function extractPlatformSchedule(ps: Record<string, unknown>): PlatformSchedule | undefined {
  const { _dry_run: _d, _preview: _p, _promoted: _pr, ...rest } = ps;
  if (Object.keys(rest).length === 0) return undefined;
  return rest as PlatformSchedule;
}

function resolvePreviewGenerated(
  job: Record<string, unknown>,
  preview: Record<string, unknown> | undefined,
): PreviewGeneratedSnapshot {
  const fromPreview = preview?.generated as PreviewGeneratedSnapshot | undefined;
  if (fromPreview?.blog_post) return fromPreview;

  const title = String(job.title ?? '');
  return {
    blog_post: String(job.content ?? ''),
    hashtags: (job.hashtags as string[]) ?? [],
    tiktok_caption: title.slice(0, 150),
    instagram_caption: title.slice(0, 300),
    threads_text: title,
    x_text: title.slice(0, 280),
    image_prompt: String(preview?.image_prompt ?? ''),
    video_prompt: '',
  };
}

/** 검증(dry_run) 완료 job → Claude/Imagen 재생성 없이 발행 큐(post_blog 등) 등록 */
export async function promoteDryRunToPublish(parentJobId: string) {
  const { data: job, error } = await supabase.from('huma_jobs').select('*').eq('id', parentJobId).single();
  if (error || !job) throw new Error('작업 없음');
  if (!isDryRunJob(job.platform_schedule)) throw new Error('검증 미리보기 작업이 아닙니다');
  if (job.status !== 'completed') throw new Error('검증 미리보기가 아직 완료되지 않았습니다');

  const ps = (job.platform_schedule as Record<string, unknown> | null) ?? {};
  const preview = ps._preview as Record<string, unknown> | undefined;
  const promoted = ps._promoted as { blog_job_id?: string } | undefined;
  if (promoted?.blog_job_id) {
    throw new Error('이미 발행 큐에 등록된 검증 작업입니다');
  }

  const imageUrl = (preview?.image_url as string | undefined) ?? job.image_urls?.[0];
  if (!job.content || !imageUrl) {
    throw new Error('본문 또는 Imagen 이미지가 없습니다');
  }

  const generated = resolvePreviewGenerated(job, preview);
  const schedule = extractPlatformSchedule(ps);
  const contentType = (job.content_type ?? 'A') as ContentType;
  const autoScheduled = job.auto_scheduled !== false;
  const baseScheduledAt =
    autoScheduled && schedule?.naver_blog
      ? resolveNaverBlogScheduledAt(schedule.naver_blog, job.scheduled_at ?? new Date().toISOString())
      : (job.scheduled_at ?? new Date().toISOString());

  const runInput: ContentOrchestratorInput = {
    workspace: job.workspace,
    title: job.title ?? '',
    sourceUrl: job.link_url ?? '',
    content_type: contentType,
    content_type_auto: false,
    auto_scheduled: autoScheduled,
    video_model: job.video_model ?? undefined,
    platform_schedule: schedule,
    scheduled_at: baseScheduledAt,
    repeat_rule: job.repeat_rule,
    parentJobId,
  };

  const result =
    contentType === 'B'
      ? await runTypeB(
          runInput,
          generated as Awaited<ReturnType<typeof generateAllContent>>,
          imageUrl,
          job.video_model ?? 'kling-3.0',
          schedule,
        )
      : await runTypeA(
          runInput,
          generated as Awaited<ReturnType<typeof generateAllContent>>,
          imageUrl,
          schedule,
        );

  await supabase
    .from('huma_jobs')
    .update({
      platform_schedule: {
        ...ps,
        _promoted: {
          blog_job_id: result.primaryJobId,
          jobs_created: result.jobsCreated,
          promoted_at: new Date().toISOString(),
        },
      },
      result_url: result.primaryJobId,
    })
    .eq('id', parentJobId);

  return result;
}
