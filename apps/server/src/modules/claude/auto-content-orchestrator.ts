import { enqueueHumaJob, type JobRecord } from '../../lib/job-scheduler.js';
import { supabase } from '../../middleware/auth.js';
import { getPostingEnabled } from '../../lib/activity-control.js';
import { assertAndReservePostingQuota, releasePostingQuotaSlot } from '../../lib/posting-quota-reserve.js';
import { resolvePostingAccount } from '../../lib/posting-accounts.js';
import { persistUploadedJobImages, normalizeUploadedImagesInput } from '../../lib/upload-job-images.js';
import { toTodayDatetime } from './auto-decide.js';
import { resolveAutoPostingInput } from '../content/auto-posting-input.js';
import {
  runContentOrchestrator,
  type ContentType,
} from '../queue/jobs/content-orchestrator.js';
import { isAutoPublishJob, replanAutoPublishSlot } from '../../lib/auto-publish-state.js';

export interface AutoContentRequest {
  workspace: string;
  account_id?: string;
  title?: string;
  source_url?: string;
  synopsis?: string;
  /** @deprecated uploaded_images 사용 */
  screenshot_base64?: string;
  uploaded_images?: string[];
  content_type?: ContentType;
  content_type_auto?: boolean;
  auto_schedule?: boolean;
  scheduled_at?: string;
  schedule_time?: string;
  repeat_rule?: string | null;
  /** true면 Claude+Imagen만 실행, post_blog·SNS 발행 job 미생성 */
  dry_run?: boolean;
  /** 스케줄러 자동발행 — platform_schedule._auto_publish */
  auto_publish?: boolean;
}

export interface AutoContentResult {
  primary_job: JobRecord;
  jobs_created: number;
  video_queue_id?: string;
  auto_picked?: boolean;
  auto_pick_label?: string;
}

export function buildScheduledAtFromTime(time: string): string {
  return toTodayDatetime(time) ?? new Date().toISOString();
}

/** 자동 배분: AI 생성은 즉시 큐. 플랫폼별 발행 시각만 Haiku가 content_full 실행 시 결정 */
export function resolveAutoContentStartAt(autoScheduled: boolean, scheduleTime?: string): string {
  if (autoScheduled) return new Date().toISOString();
  return buildScheduledAtFromTime(scheduleTime ?? '10:00');
}

export async function registerAutoContentJobs(body: AutoContentRequest): Promise<AutoContentResult> {
  if (!getPostingEnabled()) {
    throw new Error('POSTING_ACTIVITY_DISABLED');
  }

  const postingAccount = await resolvePostingAccount(body.workspace, body.account_id);
  if (!postingAccount?.id) {
    throw new Error(body.account_id ? '포스팅 계정을 찾을 수 없거나 비활성입니다' : '활성 포스팅 계정 없음');
  }

  await assertAndReservePostingQuota(body.workspace, postingAccount.id);
  let slotReserved = true;
  try {
  const contentTypeAuto = body.content_type_auto ?? body.content_type == null;
  const autoScheduled = body.auto_schedule !== false;

  const scheduledAt =
    body.scheduled_at ??
    resolveAutoContentStartAt(autoScheduled, body.schedule_time);

  const status = new Date(scheduledAt).getTime() > Date.now() ? 'scheduled' : 'pending';

  const resolved = await resolveAutoPostingInput({
    workspace: body.workspace,
    accountId: postingAccount.id,
    title: body.title,
    source_url: body.source_url,
  });

  const platformScheduleBase = (() => {
    const extras: Record<string, unknown> = {};
    if (body.dry_run) extras._dry_run = true;
    if (body.auto_publish) extras._auto_publish = true;
    if (resolved.auto_pick_label) extras._auto_pick = resolved.auto_pick_label;
    return Object.keys(extras).length ? extras : null;
  })();

  const { data: parentJob, error } = await supabase
    .from('huma_jobs')
    .insert({
      workspace: body.workspace,
      account_id: postingAccount?.id ?? null,
      job_type: 'content_full',
      content_type: body.content_type ?? 'A',
      content_type_auto: contentTypeAuto,
      auto_scheduled: autoScheduled,
      title: resolved.title,
      content: body.synopsis?.trim() || null,
      link_url: resolved.source_url,
      image_urls: null,
      scheduled_at: scheduledAt,
      repeat_rule: body.repeat_rule || null,
      platform_schedule: platformScheduleBase,
      status,
      retry_count: 0,
    })
    .select()
    .single();

  if (error || !parentJob) throw new Error(error?.message ?? '작업 등록 실패');

  await releasePostingQuotaSlot(postingAccount.id);
  slotReserved = false;

  const rawImages =
    normalizeUploadedImagesInput(body.uploaded_images) ??
    (body.screenshot_base64?.trim() ? [body.screenshot_base64.trim()] : undefined);
  if (rawImages?.length) {
    const stored = await persistUploadedJobImages(rawImages, parentJob.id);
    if (stored?.length) {
      await supabase.from('huma_jobs').update({ image_urls: stored }).eq('id', parentJob.id);
      (parentJob as Record<string, unknown>).image_urls = stored;
    }
  }

  await enqueueHumaJob(parentJob as JobRecord);

  return {
    primary_job: parentJob as JobRecord,
    jobs_created: 1,
    auto_picked: resolved.auto_picked,
    auto_pick_label: resolved.auto_pick_label,
  };
  } finally {
    if (slotReserved) {
      await releasePostingQuotaSlot(postingAccount.id).catch(() => undefined);
    }
  }
}

/** content_full BullMQ 작업에서 호출 */
export async function executeContentFull(humaJobId: string) {
  const { data: job, error } = await supabase.from('huma_jobs').select('*').eq('id', humaJobId).single();
  if (error || !job) throw new Error('content_full 작업 없음');

  const resolved = await resolveAutoPostingInput({
    workspace: job.workspace,
    accountId: job.account_id as string | null,
    title: (job.title as string | null) ?? undefined,
    source_url: (job.link_url as string | null) ?? undefined,
  });

  if (
    resolved.title !== (job.title ?? '').trim() ||
    resolved.source_url !== (job.link_url ?? '').trim()
  ) {
    await supabase
      .from('huma_jobs')
      .update({ title: resolved.title, link_url: resolved.source_url })
      .eq('id', humaJobId);
    job.title = resolved.title;
    job.link_url = resolved.source_url;
  }

  const uploadedImageUrls = Array.isArray(job.image_urls)
    ? job.image_urls.filter((u): u is string => typeof u === 'string' && Boolean(u.trim()))
    : [];

  const result = await runContentOrchestrator({
    workspace: job.workspace,
    title: job.title ?? '',
    sourceUrl: job.link_url ?? '',
    synopsis: job.content ?? undefined,
    uploadedImageUrls,
    content_type: job.content_type_auto ? undefined : (job.content_type as ContentType | undefined),
    content_type_auto: job.content_type_auto ?? true,
    auto_scheduled: job.auto_scheduled ?? true,
    video_model: job.video_model ?? undefined,
    platform_schedule: job.platform_schedule ?? undefined,
    scheduled_at: job.scheduled_at ?? new Date().toISOString(),
    repeat_rule: job.repeat_rule,
    parentJobId: humaJobId,
  });

  if (result.similaritySkipped) {
    const prevPs = (job.platform_schedule as Record<string, unknown> | null) ?? {};
    await supabase
      .from('huma_jobs')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        error_message: result.skipReason ?? '유사도 초과 — 발행 스킵',
        platform_schedule: {
          ...prevPs,
          _similarity_skipped: true,
          _similarity_skip_kind: result.skipKind ?? 'body',
          _similarity_skipped_at: new Date().toISOString(),
        },
      })
      .eq('id', humaJobId);

    if (isAutoPublishJob(job.platform_schedule) && job.account_id) {
      await replanAutoPublishSlot(job.account_id as string, job.workspace as string).catch(() => undefined);
    }

    return {
      jobs_created: 0,
      similarity_skipped: true,
      skip_reason: result.skipReason,
    };
  }

  const { data: refreshed } = await supabase.from('huma_jobs').select('*').eq('id', humaJobId).single();

  await supabase
    .from('huma_jobs')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      result_url: result.primaryJobId,
    })
    .eq('id', humaJobId);

  return {
    jobs_created: result.jobsCreated,
    primaryJobId: result.primaryJobId,
    video_queue_id: result.video_queue_id,
    content_type: refreshed?.content_type,
    video_model: refreshed?.video_model,
    platform_schedule: refreshed?.platform_schedule,
  };
}
