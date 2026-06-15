/** 발행 모니터 폴백 job 카드 — sessions API에 없을 때 (계정명은 서버 sessions API 사용) */
export function monitorJobAccountLabel(job: {
  workspace?: string | null;
}): string {
  return job.workspace ?? '계정';
}

export function monitorJobPlatformLabel(job: {
  workspace?: string | null;
  job_type?: string | null;
  platform?: string | null;
}): string {
  if (job.job_type === 'content_full') return 'naver';
  return job.platform ?? job.workspace ?? 'naver';
}
