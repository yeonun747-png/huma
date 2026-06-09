import type { BrowserContext } from 'playwright';

import { supabase } from '../../middleware/auth.js';
import { logOperation } from '../../lib/log-emitter.js';
import { closeBrowserContext } from '../playwright/browser.js';
import type { ModemSession } from '../proxy/manager.js';
import { releaseModem } from '../proxy/manager.js';
import { recordCrankSessionOnModem } from '../../lib/crank-modems.js';
import { notifyCaptchaTelegram, resolveVncUrl, buildJobWebUrl } from './telegram.js';

const HOLD_MS = 30 * 60 * 1000;
const REMIND_MS = 5 * 60 * 1000;
const MAX_REMINDS = 3;

export interface CaptchaHoldInput {
  jobId: string;
  accountId: string;
  workspace?: string | null;
  accountLabel?: string;
  jobTitle?: string;
  jobType?: string;
  context: BrowserContext;
  modemSession?: ModemSession;
  releaseAccountLock: () => void;
}

export interface CaptchaHoldOptions {
  holdMs?: number;
  isDrill?: boolean;
}

interface CaptchaHoldEntry extends CaptchaHoldInput {
  holdStartedAt: number;
  holdMs: number;
  isDrill: boolean;
  remindCount: number;
  timers: NodeJS.Timeout[];
}

const holds = new Map<string, CaptchaHoldEntry>();

function clearTimers(entry: CaptchaHoldEntry) {
  for (const t of entry.timers) clearTimeout(t);
  entry.timers.length = 0;
}

async function cleanupHold(jobId: string, entry: CaptchaHoldEntry): Promise<void> {
  clearTimers(entry);
  holds.delete(jobId);
  await closeBrowserContext(entry.context).catch(() => {});
  if (entry.modemSession) await releaseModem(entry.modemSession).catch(() => {});
  entry.releaseAccountLock();
}

async function markJobFailed(jobId: string, message: string): Promise<void> {
  await supabase
    .from('huma_jobs')
    .update({
      status: 'failed',
      error_message: message,
      completed_at: null,
    })
    .eq('id', jobId);
}

async function completeJobRecord(jobId: string, resultUrl?: string): Promise<void> {
  await supabase
    .from('huma_jobs')
    .update({
      status: 'completed',
      error_message: null,
      ...(resultUrl?.trim() ? { result_url: resultUrl.trim() } : {}),
      completed_at: new Date().toISOString(),
    })
    .eq('id', jobId);
}

function scheduleReminders(entry: CaptchaHoldEntry): void {
  const remindMs = entry.isDrill ? 60 * 1000 : REMIND_MS;
  const maxReminds = entry.isDrill ? 1 : MAX_REMINDS;

  for (let i = 1; i <= maxReminds; i += 1) {
    const t = setTimeout(() => {
      if (!holds.has(entry.jobId)) return;
      entry.remindCount = i;
      void notifyCaptchaTelegram({
        jobId: entry.jobId,
        workspace: entry.workspace,
        accountLabel: entry.accountLabel,
        jobTitle: entry.jobTitle,
        jobType: entry.jobType,
        remind: true,
        remindIndex: i,
        drill: entry.isDrill,
        force: entry.isDrill,
      });
    }, remindMs * i);
    entry.timers.push(t);
  }

  const timeout = setTimeout(() => {
    void expireCaptchaHold(entry.jobId);
  }, entry.holdMs);
  entry.timers.push(timeout);
}

export function getCaptchaHold(jobId: string): CaptchaHoldEntry | undefined {
  return holds.get(jobId);
}

export function listCaptchaHoldJobIds(): string[] {
  return [...holds.keys()];
}

/** graceful shutdown — 모든 hold의 브라우저·모뎀·계정 락을 해제하고 작업을 실패 처리 (좀비 방지) */
export async function shutdownCaptchaHolds(): Promise<void> {
  const entries = [...holds.entries()];
  for (const [jobId, entry] of entries) {
    await cleanupHold(jobId, entry).catch(() => {});
    await markJobFailed(jobId, 'SERVER_RESTART_DURING_CAPTCHA').catch(() => {});
  }
}

export async function enterCaptchaHold(
  input: CaptchaHoldInput,
  options?: CaptchaHoldOptions,
): Promise<{ telegram: Awaited<ReturnType<typeof notifyCaptchaTelegram>> }> {
  if (holds.has(input.jobId)) {
    throw new Error('CAPTCHA_HOLD_ALREADY_ACTIVE');
  }

  const isDrill = options?.isDrill === true;
  const holdMs = options?.holdMs ?? HOLD_MS;

  let accountLabel = input.accountLabel;
  if (!accountLabel?.trim() && !isDrill) {
    const { data: ac } = await supabase
      .from('huma_accounts')
      .select('name, naver_id')
      .eq('id', input.accountId)
      .maybeSingle();
    accountLabel = ac?.name ?? ac?.naver_id ?? input.accountId;
  } else if (!accountLabel?.trim()) {
    accountLabel = 'CAPTCHA DRILL';
  }

  await supabase
    .from('huma_jobs')
    .update({
      status: 'awaiting_captcha',
      error_message: isDrill ? 'CAPTCHA_DRILL' : 'CAPTCHA_AWAITING_HUMAN',
    })
    .eq('id', input.jobId);

  const entry: CaptchaHoldEntry = {
    ...input,
    accountLabel,
    holdStartedAt: Date.now(),
    holdMs,
    isDrill,
    remindCount: 0,
    timers: [],
  };
  holds.set(input.jobId, entry);
  scheduleReminders(entry);

  const telegram = await notifyCaptchaTelegram({
    jobId: input.jobId,
    workspace: input.workspace,
    accountLabel,
    jobTitle: input.jobTitle,
    jobType: input.jobType,
    drill: isDrill,
    force: isDrill,
  });

  await logOperation({
    level: isDrill ? 'info' : 'warn',
    message: isDrill
      ? 'CAPTCHA DRILL — 5분 · VNC 확인 후 huma 발행 완료'
      : input.jobType === 'social_crank'
        ? 'C-Rank CAPTCHA — 30분 세션 유지 · VNC 해결 후 huma 발행 완료'
        : 'CAPTCHA — 30분 세션 유지 · VNC 해결 후 huma 발행 완료',
    job_id: input.jobId,
    account_id: input.accountId,
  });

  return { telegram };
}

export async function cancelCaptchaHold(jobId: string): Promise<boolean> {
  const entry = holds.get(jobId);
  if (!entry) return false;

  await cleanupHold(jobId, entry);

  await logOperation({
    level: 'info',
    message: entry.isDrill ? 'CAPTCHA DRILL 큐에서 삭제 — 세션 종료' : 'CAPTCHA hold 취소',
    job_id: jobId,
    account_id: entry.accountId,
  });

  return true;
}

export async function completeCaptchaHold(
  jobId: string,
  resultUrl?: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const entry = holds.get(jobId);
  if (!entry) {
    const { data: job } = await supabase
      .from('huma_jobs')
      .select('status')
      .eq('id', jobId)
      .maybeSingle();
    if (job?.status === 'awaiting_captcha') {
      await completeJobRecord(jobId, resultUrl);
      return { ok: true };
    }
    return { ok: false, error: 'CAPTCHA_HOLD_NOT_FOUND' };
  }

  clearTimers(entry);
  holds.delete(jobId);

  await closeBrowserContext(entry.context).catch(() => {});
  if (entry.modemSession) await releaseModem(entry.modemSession).catch(() => {});
  entry.releaseAccountLock();

  await completeJobRecord(jobId, resultUrl);

  if (entry.jobType === 'social_crank') {
    const now = new Date().toISOString();
    await supabase.from('huma_accounts').update({ last_crank_at: now }).eq('id', entry.accountId);
    if (entry.modemSession) {
      await recordCrankSessionOnModem(entry.modemSession.proxyPort).catch(() => {});
    }
  }

  await notifyCaptchaTelegram({
    jobId,
    workspace: entry.workspace,
    accountLabel: entry.accountLabel,
    jobTitle: entry.jobTitle,
    jobType: entry.jobType,
    completed: true,
    drill: entry.isDrill,
    force: entry.isDrill,
  });

  await logOperation({
    level: 'info',
    message: resultUrl?.trim()
      ? `CAPTCHA 수동 완료 (URL 기록)`
      : `CAPTCHA 수동 완료 (URL 없음)`,
    job_id: jobId,
    account_id: entry.accountId,
  });

  return { ok: true };
}

export async function expireCaptchaHold(jobId: string): Promise<void> {
  const entry = holds.get(jobId);
  if (!entry) return;

  clearTimers(entry);
  holds.delete(jobId);

  await closeBrowserContext(entry.context).catch(() => {});
  if (entry.modemSession) await releaseModem(entry.modemSession).catch(() => {});
  entry.releaseAccountLock();

  await markJobFailed(jobId, entry.isDrill ? 'CAPTCHA_DRILL_TIMEOUT' : 'CAPTCHA_TIMEOUT');

  await notifyCaptchaTelegram({
    jobId,
    workspace: entry.workspace,
    accountLabel: entry.accountLabel,
    jobTitle: entry.jobTitle,
    jobType: entry.jobType,
    timedOut: true,
    drill: entry.isDrill,
    force: entry.isDrill,
  });

  await logOperation({
    level: 'ERROR',
    message: entry.isDrill
      ? 'CAPTCHA DRILL 5분 시간 초과'
      : 'CAPTCHA 30분 시간 초과 — 세션 종료',
    job_id: jobId,
    account_id: entry.accountId,
  });
}

export function getCaptchaHoldPublicInfo(jobId: string): {
  active: boolean;
  expiresAt?: string;
  workspace?: string | null;
  vncUrl?: string | null;
  webUrl?: string | null;
  isDrill?: boolean;
} | null {
  const entry = holds.get(jobId);
  if (!entry) return null;
  return {
    active: true,
    expiresAt: new Date(entry.holdStartedAt + entry.holdMs).toISOString(),
    workspace: entry.workspace,
    vncUrl: resolveVncUrl(entry.workspace),
    webUrl: buildJobWebUrl(jobId),
    isDrill: entry.isDrill,
  };
}
