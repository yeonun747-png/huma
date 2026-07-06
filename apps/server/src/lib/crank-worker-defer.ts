import { supabase } from '../middleware/auth.js';
import { logOperation } from './log-emitter.js';
import { releaseCrankModemLockForJob } from './crank-modem-lock-release.js';

export const CRANK_MODEM_DEFER_MS = 15 * 60 * 1000;
export const CRANK_PAUSE_DEFER_MS = 5 * 60 * 1000;
export const CRANK_NIGHT_DEFER_MS = 60 * 60 * 1000;

type BullDeferJob = { moveToDelayed: (ts: number, token?: string) => Promise<void> };

function deferDelayMs(delayMs: number): number {
  return Date.now() + Math.max(60_000, delayMs);
}

/**
 * BullMQ v5 — 프로세서 내부에서 지연 전환 시 token 필수.
 * 호출 측은 이 함수 직후 반드시 `throw new DelayedError()`로 종료해야
 * 워커가 job을 completed로 덮어쓰지 않는다(그렇지 않으면 "Missing lock" → 지연 유실).
 */
export async function deferBullJob(
  bullJob: BullDeferJob,
  delayMs: number,
  token?: string,
): Promise<void> {
  await bullJob.moveToDelayed(deferDelayMs(delayMs), token);
}

export async function syncHumaJobDeferred(
  humaJobId: string | undefined,
  delayMs: number,
  reason: string | null,
): Promise<string> {
  const nextAt = new Date(deferDelayMs(delayMs)).toISOString();
  if (humaJobId) {
    await supabase
      .from('huma_jobs')
      .update({
        status: 'scheduled',
        scheduled_at: nextAt,
        started_at: null,
        error_message: reason,
      })
      .eq('id', humaJobId);

    if (reason) {
      const { data: jobRow } = await supabase
        .from('huma_jobs')
        .select('job_type, account_id')
        .eq('id', humaJobId)
        .maybeSingle();
      if (jobRow?.job_type === 'social_crank') {
        await releaseCrankModemLockForJob({
          humaJobId,
          accountId: jobRow.account_id as string | null,
        }).catch(() => {});
      }
    }
  }
  return nextAt;
}

export async function deferHumaJob(
  bullJob: BullDeferJob,
  humaJobId: string | undefined,
  delayMs: number,
  opts?: {
    reason?: string | null;
    accountId?: string;
    logMessage?: string;
    level?: 'warn' | 'info';
    token?: string;
  },
): Promise<void> {
  await deferBullJob(bullJob, delayMs, opts?.token);
  await syncHumaJobDeferred(humaJobId, delayMs, opts?.reason ?? null);
  if (opts?.logMessage) {
    await logOperation({
      level: opts.level ?? 'warn',
      message: opts.logMessage,
      job_id: humaJobId,
      account_id: opts.accountId,
    });
  }
}

export function isScheduledCrankPayload(payload: Record<string, unknown>): boolean {
  return payload.scheduledCrank === true;
}

export function isRetryableCrankError(msg: string): boolean {
  const patterns = [
    'SYSTEM_PAUSED',
    'ACCOUNT_BUSY',
    'NO_IDLE_MODEM',
    'NO_MODEM',
    'MODEM_BUSY',
    'MODEM_UNHEALTHY',
    'MODEM_IP_ROTATE',
    'launchPersistentContext',
    'Target page, context or browser has been closed',
    'host-resolver-rules',
    'Failed parsing rule',
    'ERR_SOCKS_CONNECTION_FAILED',
    'net::ERR_PROXY',
    'Execution context was destroyed',
    'NIGHT_BAN',
    'ACTIVE_HOURS_BLOCKED',
  ];
  return patterns.some((p) => msg.includes(p));
}

export function isCrankModemDeferError(msg: string): boolean {
  return (
    msg === 'NO_IDLE_MODEM' ||
    msg === 'MODEM_BUSY' ||
    msg === 'NO_MODEM' ||
    msg.includes('MODEM_IP_ROTATE') ||
    msg.includes('MODEM_UNHEALTHY') ||
    msg.includes('유휴 C-Rank')
  );
}
