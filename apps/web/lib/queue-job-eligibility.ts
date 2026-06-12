import type { HumaJob } from '@huma/shared';
import { isCaptchaDrillJob } from '@huma/shared';
import { isSchedulePast } from '@/lib/format-kst';

/** LIVE·CAPTCHA 대기 — 강제 중단 가능 */
export function isAbortableQueueJob(job: HumaJob): boolean {
  return job.status === 'running' || job.status === 'awaiting_captcha';
}

/** LIVE 제외 — CAPTCHA·DRILL은 VNC 세션 종료 후 삭제 가능 */
export function isDeletableQueueJob(job: HumaJob): boolean {
  if (isCaptchaDrillJob(job)) return true;
  if (job.status === 'awaiting_captcha') return true;
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
