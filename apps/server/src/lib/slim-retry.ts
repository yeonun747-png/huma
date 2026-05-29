import { supabase } from '../middleware/auth.js';
import { enqueueJob } from '../modules/queue/producer.js';

/** KT M mobile 초알뜰 — 데이터 소진·프록시 차단 시 다음날(KST) 자정 재시도 */
export function isSlimDataCapError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toUpperCase();
  return (
    msg.includes('DATA_CAP_EXHAUSTED') ||
    msg.includes('SLIM_DATA_BLOCKED') ||
    msg.includes('PROXY_DATA_CAP') ||
    msg.includes('NET::ERR_PROXY_CONNECTION_FAILED')
  );
}

/** KST 다음 자정까지 ms */
export function msUntilKoreaMidnight(): number {
  const now = new Date();
  const kstOffsetMs = 9 * 60 * 60 * 1000;
  const kstNow = new Date(now.getTime() + kstOffsetMs);
  const nextMidnightKst = new Date(
    Date.UTC(kstNow.getUTCFullYear(), kstNow.getUTCMonth(), kstNow.getUTCDate() + 1, 0, 0, 0, 0),
  );
  const nextMidnightUtc = new Date(nextMidnightKst.getTime() - kstOffsetMs);
  return Math.max(60_000, nextMidnightUtc.getTime() - now.getTime());
}

export async function scheduleSlimCapRetry(
  humaJobId: string,
  jobData: Record<string, unknown>,
): Promise<void> {
  const delay = msUntilKoreaMidnight();
  const scheduledAt = new Date(Date.now() + delay).toISOString();

  await supabase
    .from('huma_jobs')
    .update({
      status: 'scheduled',
      scheduled_at: scheduledAt,
      error_message: '초알뜰 데이터 소진 — KST 자정 자동 재시도 예약',
      started_at: null,
    })
    .eq('id', humaJobId);

  await enqueueJob(jobData, { delay, jobId: `huma-${humaJobId}-slim-${Date.now()}` });
}
