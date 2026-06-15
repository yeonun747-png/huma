const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isJobIdLike(value: string | null | undefined): boolean {
  const v = value?.trim();
  return Boolean(v && UUID_RE.test(v));
}

function isDryRunPlatformSchedule(platformSchedule: unknown): boolean {
  if (!platformSchedule || typeof platformSchedule !== 'object') return false;
  return (platformSchedule as Record<string, unknown>)._dry_run === true;
}

/** Claude가 post_blog 등 자식 job을 만든 content_full — 큐·캘린더·집계에서 숨김 */
export function isContentFullPipelineShell(job: {
  job_type?: string | null;
  result_url?: string | null;
  platform_schedule?: unknown;
}): boolean {
  if (job.job_type !== 'content_full') return false;
  if (isDryRunPlatformSchedule(job.platform_schedule)) return false;

  const ps = job.platform_schedule as Record<string, unknown> | undefined;
  const promoted = ps?._promoted as { blog_job_id?: string } | undefined;
  if (promoted?.blog_job_id) return true;

  return isJobIdLike(job.result_url);
}
