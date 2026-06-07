import type { HumaJob } from '@huma/shared';
import { isCaptchaDrillJob } from '@huma/shared';
import { isSchedulePast } from '@/lib/format-kst';

/** LIVE·캡cha 대기 제외 — DRILL은 LIVE/CAPTCHA 포함 삭제 가능 */
export function isDeletableQueueJob(job: HumaJob): boolean {
  if (isCaptchaDrillJob(job)) return true;
  return job.status !== 'running' && job.status !== 'awaiting_captcha';
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
