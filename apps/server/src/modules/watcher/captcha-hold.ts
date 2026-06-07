import type { BrowserContext } from 'playwright';

import { supabase } from '../../middleware/auth.js';
import { logOperation } from '../../lib/log-emitter.js';
import { closeBrowserContext } from '../playwright/browser.js';
import type { ModemSession } from '../proxy/manager.js';
import { releaseModem } from '../proxy/manager.js';
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

interface CaptchaHoldEntry extends CaptchaHoldInput {
  holdStartedAt: number;
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
  for (let i = 1; i <= MAX_REMINDS; i += 1) {
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
      });
    }, REMIND_MS * i);
    entry.timers.push(t);
  }

  const timeout = setTimeout(() => {
    void expireCaptchaHold(entry.jobId);
  }, HOLD_MS);
  entry.timers.push(timeout);
}

export function getCaptchaHold(jobId: string): CaptchaHoldEntry | undefined {
  return holds.get(jobId);
}

export function listCaptchaHoldJobIds(): string[] {
  return [...holds.keys()];
}

export async function enterCaptchaHold(input: CaptchaHoldInput): Promise<void> {
  if (holds.has(input.jobId)) {
    throw new Error('CAPTCHA_HOLD_ALREADY_ACTIVE');
  }

  let accountLabel = input.accountLabel;
  if (!accountLabel?.trim()) {
    const { data: ac } = await supabase
      .from('huma_accounts')
      .select('name, naver_id')
      .eq('id', input.accountId)
      .maybeSingle();
    accountLabel = ac?.name ?? ac?.naver_id ?? input.accountId;
  }

  await supabase
    .from('huma_jobs')
    .update({
      status: 'awaiting_captcha',
      error_message: 'CAPTCHA_AWAITING_HUMAN',
    })
    .eq('id', input.jobId);

  const entry: CaptchaHoldEntry = {
    ...input,
    accountLabel,
    holdStartedAt: Date.now(),
    remindCount: 0,
    timers: [],
  };
  holds.set(input.jobId, entry);
  scheduleReminders(entry);

  await notifyCaptchaTelegram({
    jobId: input.jobId,
    workspace: input.workspace,
    accountLabel,
    jobTitle: input.jobTitle,
    jobType: input.jobType,
  });

  await logOperation({
    level: 'warn',
    message: 'CAPTCHA — 30분 세션 유지 · VNC 해결 후 huma 발행 완료',
    job_id: input.jobId,
    account_id: input.accountId,
  });
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

  await notifyCaptchaTelegram({
    jobId,
    workspace: entry.workspace,
    accountLabel: entry.accountLabel,
    jobTitle: entry.jobTitle,
    jobType: entry.jobType,
    completed: true,
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

  await markJobFailed(jobId, 'CAPTCHA_TIMEOUT');

  await notifyCaptchaTelegram({
    jobId,
    workspace: entry.workspace,
    accountLabel: entry.accountLabel,
    jobTitle: entry.jobTitle,
    jobType: entry.jobType,
    timedOut: true,
  });

  await logOperation({
    level: 'ERROR',
    message: 'CAPTCHA 30분 시간 초과 — 세션 종료',
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
} | null {
  const entry = holds.get(jobId);
  if (!entry) return null;
  return {
    active: true,
    expiresAt: new Date(entry.holdStartedAt + HOLD_MS).toISOString(),
    workspace: entry.workspace,
    vncUrl: resolveVncUrl(entry.workspace),
    webUrl: buildJobWebUrl(jobId),
  };
}
