function isDryRunPlatformSchedule(platformSchedule: unknown): boolean {
  if (!platformSchedule || typeof platformSchedule !== 'object') return false;
  return (platformSchedule as Record<string, unknown>)._dry_run === true;
}

/**
 * 운영자가 등록한 content_full(Claude 생성 스케줄) — post_blog 생성 후 큐·캘린더·집계에서 숨김.
 * dry_run(검증) job은 유지. 완료된 content_full = 파이프라인 셸(실제 발행은 post_blog).
 */
export function isContentFullPipelineShell(job: {
  job_type?: string | null;
  status?: string | null;
  result_url?: string | null;
  platform_schedule?: unknown;
}): boolean {
  if (job.job_type !== 'content_full') return false;
  if (isDryRunPlatformSchedule(job.platform_schedule)) return false;
  // completed-only 쿼리(status 미select)에서도 셸 판별
  return job.status == null || job.status === 'completed';
}

/** 캘린더·수동 예약 등 AI 파이프라인 없이 직접 넣은 큐 */
export function isManualQueuePublishJob(job: {
  job_type?: string | null;
  link_url?: string | null;
  content_type?: string | null;
}): boolean {
  if (job.job_type !== 'post_blog') return false;
  return !job.link_url?.trim() || !job.content_type;
}

/**
 * 대시보드 발행 집계 — AI 파이프라인 post_blog만 (셸·검증·드릴·수동 큐 제외)
 */
export function isDashboardPublishCountJob(job: {
  job_type?: string | null;
  status?: string | null;
  result_url?: string | null;
  platform_schedule?: unknown;
  link_url?: string | null;
  content_type?: string | null;
  title?: string | null;
}): boolean {
  if (job.job_type !== 'post_blog') return false;
  if (isContentFullPipelineShell(job)) return false;
  if (isManualQueuePublishJob(job)) return false;
  if (isDryRunPlatformSchedule(job.platform_schedule)) return false;
  if ((job.title ?? '').startsWith('[DRILL]')) return false;
  if (job.platform_schedule && typeof job.platform_schedule === 'object') {
    if ((job.platform_schedule as Record<string, unknown>)._captcha_drill === true) return false;
  }
  return true;
}

const HUMA_JOB_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** post_blog 발행 완료 — 네이버 등 실제 URL (내부 job UUID 제외) */
export function isPublishedBlogResultUrl(url: string | null | undefined): boolean {
  const u = url?.trim();
  if (!u) return false;
  if (HUMA_JOB_ID_RE.test(u)) return false;
  if (/^https?:\/\//i.test(u)) return true;
  return /blog\.naver\.com|PostView|logNo=/i.test(u);
}

/** 대시보드 · 오늘 발행 현황 목록 */
export function isDashboardPublishListJob(job: {
  job_type?: string | null;
  status?: string | null;
  result_url?: string | null;
  platform_schedule?: unknown;
  link_url?: string | null;
  content_type?: string | null;
  title?: string | null;
}): boolean {
  return isDashboardPublishCountJob(job) && isPublishedBlogResultUrl(job.result_url);
}
