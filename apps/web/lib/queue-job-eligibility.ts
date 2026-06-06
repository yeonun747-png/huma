import type { HumaJob } from '@huma/shared';
import { isSchedulePast } from '@/lib/format-kst';

/** LIVE 제외 — 실패·지연·완료·대기 등 큐에서 제거 가능 */
export function isDeletableQueueJob(job: HumaJob): boolean {
  return job.status !== 'running';
}

/** 예약일 지난 실패, 또는 예약일 지난 미실행(지연) */
export function isStaleOrFailedQueueJob(job: HumaJob): boolean {
  if (job.status === 'failed') return true;
  return Boolean(
    job.scheduled_at &&
      isSchedulePast(job.scheduled_at) &&
      ['scheduled', 'pending', 'paused'].includes(job.status),
  );
}

export function isPausableQueueJob(job: HumaJob): boolean {
  return ['pending', 'scheduled', 'paused'].includes(job.status);
}
