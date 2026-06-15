/** 발행 모니터 카드 — 계정·플랫폼 표시 (sessions API 폴백 job 카드) */
export function monitorJobAccountLabel(job: {
  workspace?: string | null;
  job_type?: string | null;
  account_id?: string | null;
  platform?: string | null;
}): string {
  if (job.workspace === 'yeonun' && (job.job_type === 'content_full' || !job.account_id)) {
    return '연운계정1-3';
  }
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
