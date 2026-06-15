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
  return job.status === 'completed';
}
