import { enqueueHumaJob, type JobRecord } from '../../lib/job-scheduler.js';
import { supabase } from '../../middleware/auth.js';
import { getPostingEnabled } from '../../lib/activity-control.js';
import { toTodayDatetime } from './auto-decide.js';
import {
  runContentOrchestrator,
  type ContentType,
} from '../queue/jobs/content-orchestrator.js';

export interface AutoContentRequest {
  workspace: string;
  title: string;
  source_url: string;
  synopsis?: string;
  screenshot_base64?: string;
  content_type?: ContentType;
  content_type_auto?: boolean;
  auto_schedule?: boolean;
  scheduled_at?: string;
  schedule_time?: string;
  repeat_rule?: string | null;
  /** true면 Claude+Imagen만 실행, post_blog·SNS 발행 job 미생성 */
  dry_run?: boolean;
}

export interface AutoContentResult {
  primary_job: JobRecord;
  jobs_created: number;
  video_queue_id?: string;
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
  const contentTypeAuto = body.content_type_auto ?? body.content_type == null;
  const autoScheduled = body.auto_schedule !== false;

  const scheduledAt =
    body.scheduled_at ??
    resolveAutoContentStartAt(autoScheduled, body.schedule_time);

  const status = new Date(scheduledAt).getTime() > Date.now() ? 'scheduled' : 'pending';

  const { data: parentJob, error } = await supabase
    .from('huma_jobs')
    .insert({
      workspace: body.workspace,
      job_type: 'content_full',
      content_type: body.content_type ?? 'A',
      content_type_auto: contentTypeAuto,
      auto_scheduled: autoScheduled,
      title: body.title.trim(),
      content: body.synopsis?.trim() || null,
      link_url: body.source_url.trim(),
      image_urls: body.screenshot_base64 ? [body.screenshot_base64] : null,
      scheduled_at: scheduledAt,
      repeat_rule: body.repeat_rule || null,
      platform_schedule: body.dry_run ? { _dry_run: true } : null,
      status,
      retry_count: 0,
    })
    .select()
    .single();

  if (error || !parentJob) throw new Error(error?.message ?? '작업 등록 실패');

  await enqueueHumaJob(parentJob as JobRecord);

  return {
    primary_job: parentJob as JobRecord,
    jobs_created: 1,
  };
}

/** content_full BullMQ 작업에서 호출 */
export async function executeContentFull(humaJobId: string) {
  const { data: job, error } = await supabase.from('huma_jobs').select('*').eq('id', humaJobId).single();
  if (error || !job) throw new Error('content_full 작업 없음');

  const result = await runContentOrchestrator({
    workspace: job.workspace,
    title: job.title ?? '',
    sourceUrl: job.link_url ?? '',
    synopsis: job.content ?? undefined,
    screenshotBase64: job.image_urls?.[0]?.startsWith('data:') ? job.image_urls[0] : undefined,
    content_type: job.content_type_auto ? undefined : (job.content_type as ContentType | undefined),
    content_type_auto: job.content_type_auto ?? true,
    auto_scheduled: job.auto_scheduled ?? true,
    video_model: job.video_model ?? undefined,
    platform_schedule: job.platform_schedule ?? undefined,
    scheduled_at: job.scheduled_at ?? new Date().toISOString(),
    repeat_rule: job.repeat_rule,
    parentJobId: humaJobId,
  });

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
