import type { BrowserContext } from 'playwright';

import { supabase } from '../../middleware/auth.js';
import { logOperation } from '../../lib/log-emitter.js';
import { closeBrowserContext } from '../playwright/browser.js';
import type { ModemSession } from '../proxy/manager.js';
import { releaseModem } from '../proxy/manager.js';
import { resumeSocialCrankAfterCaptcha } from '../../lib/crank-captcha-resume.js';
import { resumePostingAfterCaptcha } from '../../lib/posting-captcha-resume.js';
import { continuePostBlogFromCaptchaHold } from '../../lib/posting-captcha-continue.js';
import {
  ensurePostingSessionAfterCaptcha,
} from '../../lib/posting-captcha-session.js';
import { isNaverCaptchaVisible, pickNaverCaptchaPage } from '../../lib/naver-captcha-vision.js';
import { vncSlotLabelKo } from '../../lib/vnc-window-layout.js';
import { enforceVncWindowBounds } from '../../lib/vnc-window-guard.js';
import { notifyCaptchaTelegram, resolveVncUrl, buildJobWebUrl } from './telegram.js';

const HOLD_MS = 30 * 60 * 1000;
const REMIND_MS = 5 * 60 * 1000;
const MAX_REMINDS = 3;
const CAPTCHA_AUTO_RESUME_MS = 10_000;

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
  /** post_blog 재개 시 executePostBlog payload (동일 브라우저 세션) */
  payload?: Record<string, unknown>;
  /** Vision 3회 실패 후 VNC 폴백 */
  visionAutoFailed?: boolean;
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
  visionAutoFailed: boolean;
  resumingInProgress: boolean;
  /** 자동 재개 인터벌 틱 중복 실행 방지 (resumingInProgress 와 별개 — completeCaptchaHold 가 후자를 소유) */
  autoResumeFiring: boolean;
  timers: NodeJS.Timeout[];
}

const holds = new Map<string, CaptchaHoldEntry>();
/** completeCaptchaHold 동시 호출 방지 — 이중 재개·재큐 방지 */
const completingHold = new Set<string>();

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

  if (
    !entry.isDrill &&
    (entry.jobType === 'post_blog' || entry.jobType === 'cafe_new_post')
  ) {
    const autoResume = setInterval(() => {
      void tryAutoResumePostingCaptcha(entry);
    }, CAPTCHA_AUTO_RESUME_MS);
    entry.timers.push(autoResume);
  }

  const timeout = setTimeout(() => {
    void expireCaptchaHold(entry.jobId);
  }, entry.holdMs);
  entry.timers.push(timeout);
}

async function tryAutoResumePostingCaptcha(entry: CaptchaHoldEntry): Promise<void> {
  if (!holds.has(entry.jobId) || entry.resumingInProgress || entry.autoResumeFiring) return;

  const page = pickNaverCaptchaPage(entry.context);
  if (!page || page.isClosed()) return;
  if (await isNaverCaptchaVisible(page)) return;

  const url = page.url();
  if (url === 'about:blank' || url === '') return;

  entry.autoResumeFiring = true;
  try {
    const sessionReady = await ensurePostingSessionAfterCaptcha(entry.context, entry.accountId);
    if (!sessionReady) return;

    await logOperation({
      level: 'info',
      message: '[post_blog] CAPTCHA 해결·로그인 확인 — 발행 자동 재개',
      job_id: entry.jobId,
      account_id: entry.accountId,
    });
    // completeCaptchaHold 가 resumingInProgress·clearTimers·holds.delete 를 직접 관리한다.
    await completeCaptchaHold(entry.jobId);
  } finally {
    const live = holds.get(entry.jobId);
    if (live) live.autoResumeFiring = false;
  }
}

export function getCaptchaHold(jobId: string): CaptchaHoldEntry | undefined {
  return holds.get(jobId);
}

export function listCaptchaHoldJobIds(): string[] {
  return [...holds.keys()];
}

/** CAPTCHA·2FA hold — 로그인 탭을 about:blank 로 되돌리면 안 됨 */
export function shouldPreserveBrowserPageForVnc(err: unknown): boolean {
  const msg = (err as Error)?.message ?? '';
  if (msg.includes('CAPTCHA') || msg.toLowerCase().includes('captcha')) return true;
  if (msg.includes('429') || msg.includes('BLOCK') || msg.includes('Layer4')) return true;
  if (msg.includes('NAVER_LOGIN_2FA')) return true;
  if (msg.includes('NAVER_LOGIN_DEVICE_VERIFY')) return true;
  if (msg.includes('reason=block_captcha')) return true;
  if (msg.includes('NAVER_LOGIN_FAILED:redirect_stuck')) return true;
  return false;
}

async function focusVncBrowserPage(
  context: BrowserContext,
  proxyPort?: number,
): Promise<void> {
  const pages = context.pages();
  const page =
    pages.find((p) => {
      const u = p.url();
      return (
        u.includes('nid.naver.com') ||
        u.includes('captcha') ||
        (u.includes('naver.com') && u !== 'about:blank')
      );
    }) ?? pages[0];
  if (!page) return;
  await page.bringToFront().catch(() => {});
  if (proxyPort) {
    await enforceVncWindowBounds(context, proxyPort, false).catch(() => {});
  }
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
    visionAutoFailed: input.visionAutoFailed === true,
    resumingInProgress: false,
    autoResumeFiring: false,
    timers: [],
  };
  holds.set(input.jobId, entry);
  scheduleReminders(entry);
  await focusVncBrowserPage(input.context, input.modemSession?.proxyPort);

  const vncSlotLabel = input.modemSession?.proxyPort
    ? vncSlotLabelKo(input.modemSession.proxyPort)
    : undefined;

  const telegram = await notifyCaptchaTelegram({
    jobId: input.jobId,
    workspace: input.workspace,
    accountLabel,
    jobTitle: input.jobTitle,
    jobType: input.jobType,
    drill: isDrill,
    force: isDrill,
    visionAutoFailed: input.visionAutoFailed,
    vncSlotLabel,
  });

  await logOperation({
    level: isDrill ? 'info' : 'warn',
    message: isDrill
      ? 'CAPTCHA DRILL — 5분 · VNC 확인 후 huma 발행 완료'
      : input.jobType === 'social_crank'
        ? 'C-Rank CAPTCHA — 30분 세션 유지 · VNC 해결 후 huma 활동 재개'
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
  if (completingHold.has(jobId)) {
    return { ok: true };
  }

  const entry = holds.get(jobId);
  if (!entry) {
    const { data: job } = await supabase
      .from('huma_jobs')
      .select('status, job_type, account_id')
      .eq('id', jobId)
      .maybeSingle();
    if (job?.status === 'running') {
      return { ok: true };
    }
    if (job?.status === 'awaiting_captcha') {
      if (job.job_type === 'social_crank' && job.account_id) {
        await resumeSocialCrankAfterCaptcha(jobId, job.account_id);
        await logOperation({
          level: 'info',
          message: 'CAPTCHA 해결 — C-Rank 활동 재개 예약 (hold 만료 후)',
          job_id: jobId,
          account_id: job.account_id,
        });
        return { ok: true };
      }
      if (
        (job.job_type === 'post_blog' || job.job_type === 'cafe_new_post') &&
        job.account_id &&
        !resultUrl?.trim()
      ) {
        await resumePostingAfterCaptcha(jobId, job.account_id);
        return { ok: true };
      }
      await completeJobRecord(jobId, resultUrl);
      return { ok: true };
    }
    return { ok: false, error: 'CAPTCHA_HOLD_NOT_FOUND' };
  }

  const isCrank = entry.jobType === 'social_crank';
  const preferredProxyPort = entry.modemSession?.proxyPort;
  const accountId = entry.accountId;
  const holdMeta = {
    workspace: entry.workspace,
    accountLabel: entry.accountLabel,
    jobTitle: entry.jobTitle,
    jobType: entry.jobType,
    isDrill: entry.isDrill,
  };

  if (entry.resumingInProgress) {
    return { ok: false, error: 'CAPTCHA_RESUME_IN_PROGRESS' };
  }
  completingHold.add(jobId);
  try {
  entry.resumingInProgress = true;
  clearTimers(entry);
  holds.delete(jobId);

  let resumeOk = true;
  let resumeError: string | undefined;

  if (resultUrl?.trim()) {
    await closeBrowserContext(entry.context).catch(() => {});
    if (entry.modemSession) await releaseModem(entry.modemSession).catch(() => {});
    entry.releaseAccountLock();
    await completeJobRecord(jobId, resultUrl);
  } else if (isCrank) {
    await closeBrowserContext(entry.context).catch(() => {});
    if (entry.modemSession) await releaseModem(entry.modemSession).catch(() => {});
    entry.releaseAccountLock();
    await resumeSocialCrankAfterCaptcha(jobId, accountId, preferredProxyPort);
  } else if (entry.jobType === 'post_blog' && entry.payload) {
    const sessionOk = await ensurePostingSessionAfterCaptcha(entry.context, entry.accountId).catch(
      () => false,
    );
    if (!sessionOk) {
      entry.resumingInProgress = false;
      holds.set(jobId, entry);
      scheduleReminders(entry);
      return { ok: false, error: 'CAPTCHA_LOGIN_NOT_READY' };
    }

    const cont = await continuePostBlogFromCaptchaHold({
      jobId,
      accountId,
      context: entry.context,
      modemSession: entry.modemSession,
      payload: entry.payload,
      releaseAccountLock: entry.releaseAccountLock,
      workspace: entry.workspace,
      accountLabel: entry.accountLabel,
      jobTitle: entry.jobTitle,
    });
    if (cont.reHeld) {
      return { ok: true };
    }
    resumeOk = cont.ok;
    resumeError = cont.error;
  } else if (entry.jobType === 'post_blog' || entry.jobType === 'cafe_new_post') {
    await closeBrowserContext(entry.context).catch(() => {});
    if (entry.modemSession) await releaseModem(entry.modemSession).catch(() => {});
    entry.releaseAccountLock();
    await resumePostingAfterCaptcha(jobId, accountId);
  } else {
    await closeBrowserContext(entry.context).catch(() => {});
    if (entry.modemSession) await releaseModem(entry.modemSession).catch(() => {});
    entry.releaseAccountLock();
    await completeJobRecord(jobId, resultUrl);
  }

  if (!resumeOk) {
    await notifyCaptchaTelegram({
      jobId,
      workspace: holdMeta.workspace,
      accountLabel: holdMeta.accountLabel,
      jobTitle: holdMeta.jobTitle,
      jobType: holdMeta.jobType,
      timedOut: false,
      drill: holdMeta.isDrill,
      force: holdMeta.isDrill,
    }).catch(() => {});
    return { ok: false, error: resumeError ?? 'CAPTCHA_RESUME_FAILED' };
  }

  await notifyCaptchaTelegram({
    jobId,
    workspace: holdMeta.workspace,
    accountLabel: holdMeta.accountLabel,
    jobTitle: holdMeta.jobTitle,
    jobType: holdMeta.jobType,
    completed: true,
    drill: holdMeta.isDrill,
    force: holdMeta.isDrill,
  });

  await logOperation({
    level: 'info',
    message: isCrank
      ? 'CAPTCHA 해결 — C-Rank 블로그 방문·공감·댓글 재개 예약'
      : entry.jobType === 'post_blog'
        ? resultUrl?.trim()
          ? 'CAPTCHA 수동 발행 완료 (URL 기록)'
          : entry.payload
            ? 'CAPTCHA 해결 — 동일 세션에서 블로그 발행 완료'
            : 'CAPTCHA 해결 — 발행 자동화 재개 예약'
        : entry.jobType === 'cafe_new_post'
          ? resultUrl?.trim()
            ? 'CAPTCHA 수동 발행 완료 (URL 기록)'
            : 'CAPTCHA 해결 — 발행 자동화 재개 예약'
          : resultUrl?.trim()
            ? 'CAPTCHA 수동 완료 (URL 기록)'
            : 'CAPTCHA 수동 완료 (URL 없음)',
    job_id: jobId,
    account_id: accountId,
  });

  return { ok: true };
  } finally {
    completingHold.delete(jobId);
  }
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
