const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isJobIdLike(value: string | null | undefined): boolean {
  const v = value?.trim();
  return Boolean(v && UUID_RE.test(v));
}

function isDryRunPlatformSchedule(platformSchedule: unknown): boolean {
  if (!platformSchedule || typeof platformSchedule !== 'object') return false;
  return (platformSchedule as Record<string, unknown>)._dry_run === true;
}

/**
 * 운영자가 등록한 content_full(Claude 생성 스케줄) — post_blog 생성 후 큐·캘린더·집계에서 숨김.
 * dry_run(검증) job은 유지.
 */
export function isContentFullPipelineShell(job: {
  job_type?: string | null;
  status?: string | null;
  result_url?: string | null;
  platform_schedule?: unknown;
}): boolean {
  if (job.job_type !== 'content_full') return false;
  if (isDryRunPlatformSchedule(job.platform_schedule)) return false;

  const ps = job.platform_schedule as Record<string, unknown> | undefined;
  if (ps?._promoted) return true;

  const resultUrl = job.result_url?.trim();
  if (!resultUrl) return false;

  // 생성 완료 후 result_url = post_blog id 또는 발행 URL
  if (job.status === 'completed') return true;

  return isJobIdLike(resultUrl);
}
