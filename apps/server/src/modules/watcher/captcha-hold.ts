import type { BrowserContext, Page } from 'playwright';

import { supabase } from '../../middleware/auth.js';
import { logOperation } from '../../lib/log-emitter.js';
import { closeBrowserContext } from '../playwright/browser.js';
import type { ModemSession } from '../proxy/manager.js';
import { releaseModem } from '../proxy/manager.js';
import { resumeSocialCrankAfterCaptcha } from '../../lib/crank-captcha-resume.js';
import { resumePostingAfterCaptcha } from '../../lib/posting-captcha-resume.js';
import { continuePostBlogFromCaptchaHold } from '../../lib/posting-captcha-continue.js';
import { recordPublishedPost } from '../blog-check/post-record.js';
import {
  buildPostBlogPayloadFromJob,
  ensurePostingSessionAfterCaptcha,
  isPostingAutoResumeBlocked,
  persistPostingSessionBeforeHoldClose,
  pickPostingWorkflowPage,
} from '../../lib/posting-captcha-session.js';
import {
  isNaverCaptchaVisible,
  isNaverLoginPendingAfterCaptcha,
  pickNaverCaptchaPage,
} from '../../lib/naver-captcha-vision.js';
import { ensureNaverLoginCredentialsForCaptcha } from '../../lib/naver-login-fields.js';
import { isNaverAuthChallengePage } from '../../lib/naver-auth-challenge.js';
import { vncSlotLabelKo } from '../../lib/vnc-window-layout.js';
import { enforceVncWindowBounds } from '../../lib/vnc-window-guard.js';
import { purgePostBlogStorageMedia } from '../../lib/cleanup-post-blog-storage.js';
import { scheduleWorkspaceQueueStatsRefresh } from '../../lib/workspace-queue-stats.js';
import { notifyCaptchaTelegram, resolveTelegramChatId, resolveVncUrl, buildJobWebUrl } from './telegram.js';
import { deleteCaptchaHoldScreenshot, saveCaptchaHoldScreenshot } from '../../lib/captcha-hold-screenshot.js';
import { clearCaptchaTelegramMessagesForJob } from '../../lib/captcha-telegram-registry.js';
import { consolidateNaverLoginTabs } from '../../lib/naver-login-session.js';

const HOLD_MS = 30 * 60 * 1000;
const REMIND_MS = 5 * 60 * 1000;
const MAX_REMINDS = 3;
const CAPTCHA_AUTO_RESUME_MS = 1_500;
/** hold 중 CAPTCHA 재출제(2중) 감지 폴링 */
const CAPTCHA_HOLD_POLL_MS = 2_000;
/** 2중 CAPTCHA 텔레그램 재알림 최소 간격 */
const SECOND_CAPTCHA_TELEGRAM_COOLDOWN_MS = 90_000;

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
  screenshotPath?: string | null;
  screenshotUpdatedAt?: number;
  /** 1=최초, 2+=2중·재출제 CAPTCHA */
  captchaRound: number;
  captchaCurrentlyVisible: boolean;
  captchaClearedOnce: boolean;
  lastSecondCaptchaNotifyAt?: number;
  /** 텔레그램 CAPTCHA 알림 message_id (pm2 재시작 후 답장 매칭 복구) */
  lastTelegramChatId?: string;
  lastTelegramMessageId?: number;
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
  clearCaptchaTelegramMessagesForJob(jobId);
  await deleteCaptchaHoldScreenshot(jobId).catch(() => {});
  await closeBrowserContext(entry.context).catch(() => {});
  if (entry.modemSession) await releaseModem(entry.modemSession).catch(() => {});
  entry.releaseAccountLock();
}

/** CAPTCHA 화면 캡처 — 2중 캡차·오답 재출제 시 갱신 */
export async function refreshCaptchaHoldScreenshot(
  entry: CaptchaHoldEntry,
  page?: Page | null,
): Promise<string | null> {
  const shotPage =
    page ??
    (await pickNaverCaptchaPage(entry.context)) ??
    pickPostingWorkflowPage(entry.context);
  if (!shotPage || shotPage.isClosed()) return entry.screenshotPath ?? null;
  if (!(await isNaverCaptchaVisible(shotPage))) return entry.screenshotPath ?? null;

  const path = await saveCaptchaHoldScreenshot(shotPage, entry.jobId);
  if (path) {
    entry.screenshotPath = path;
    entry.screenshotUpdatedAt = Date.now();
  }
  return path;
}

/**
 * hold 중 CAPTCHA 상태 동기화 — 2중 캡차 감지·비번 재입력·캡처·텔레그램 재알림.
 * (최초 1회 통과 후 다시 CAPTCHA가 보이면 2중 캡차로 처리)
 */
export async function syncCaptchaHoldState(
  entry: CaptchaHoldEntry,
  page?: Page | null,
  options?: {
    treatAsSecondRound?: boolean;
    /** 기본 false — 폴링 시 캡처·비번 재입력으로 VNC 깜빡임 방지 */
    captureScreenshot?: boolean;
    refillPassword?: boolean;
  },
): Promise<void> {
  if (!holds.has(entry.jobId) || entry.resumingInProgress) return;

  const shotPage =
    page ??
    (await pickNaverCaptchaPage(entry.context)) ??
    pickPostingWorkflowPage(entry.context);
  if (!shotPage || shotPage.isClosed()) return;

  const visible = await isNaverCaptchaVisible(shotPage);

  if (!visible) {
    if (entry.captchaCurrentlyVisible) {
      entry.captchaClearedOnce = true;
    }
    entry.captchaCurrentlyVisible = false;
    return;
  }

  const isSecondRound = entry.captchaClearedOnce && !entry.captchaCurrentlyVisible;
  entry.captchaCurrentlyVisible = true;

  const shouldRefill =
    isSecondRound ||
    options?.treatAsSecondRound === true ||
    options?.refillPassword === true;
  if (shouldRefill && shotPage.url().includes('nidlogin')) {
    if (!(await isNaverAuthChallengePage(shotPage))) {
      await ensureNaverLoginCredentialsForCaptcha(shotPage, entry.accountId, { fast: true }).catch(
        () => {},
      );
    }
  }

  const shouldCapture =
    options?.captureScreenshot === true || isSecondRound || options?.treatAsSecondRound === true;
  if (shouldCapture) {
    await refreshCaptchaHoldScreenshot(entry, shotPage);
  }

  if (isSecondRound) {
    entry.captchaRound += 1;
    entry.captchaClearedOnce = false;
    await notifySecondCaptchaTelegram(entry);
  } else if (options?.treatAsSecondRound && entry.captchaRound === 1) {
    entry.captchaRound = 2;
    await notifySecondCaptchaTelegram(entry);
  }
}

async function notifySecondCaptchaTelegram(entry: CaptchaHoldEntry): Promise<void> {
  const now = Date.now();
  if (
    entry.lastSecondCaptchaNotifyAt &&
    now - entry.lastSecondCaptchaNotifyAt < SECOND_CAPTCHA_TELEGRAM_COOLDOWN_MS
  ) {
    return;
  }
  entry.lastSecondCaptchaNotifyAt = now;

  const vncSlotLabel = entry.modemSession?.proxyPort
    ? vncSlotLabelKo(entry.modemSession.proxyPort)
    : undefined;

  const envChatId = resolveTelegramChatId(entry.workspace);
  const telegram = await notifyCaptchaTelegram({
    jobId: entry.jobId,
    workspace: entry.workspace,
    accountLabel: entry.accountLabel,
    jobTitle: entry.jobTitle,
    jobType: entry.jobType,
    drill: entry.isDrill,
    force: entry.isDrill,
    secondCaptcha: true,
    secondCaptchaRound: entry.captchaRound,
    screenshotPath: entry.screenshotPath,
    vncSlotLabel,
  });
  rememberCaptchaTelegramOutbound(entry, telegram, envChatId);

  await logOperation({
    level: 'warn',
    message: `[CAPTCHA] 2중 캡차 감지 (라운드 ${entry.captchaRound}) — 비번 재입력·캡처·텔레그램 재알림`,
    job_id: entry.jobId,
    account_id: entry.accountId,
  });
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
  const published = Boolean(resultUrl?.trim());
  const { data: job } = await supabase
    .from('huma_jobs')
    .select('job_type, image_urls, account_id, title, content, link_url, workspace, content_type')
    .eq('id', jobId)
    .maybeSingle();

  if (job?.job_type === 'post_blog' && published) {
    await purgePostBlogStorageMedia(job.image_urls as string[] | null, {
      jobId,
      accountId: job.account_id as string | undefined,
    });
  }

  await supabase
    .from('huma_jobs')
    .update({
      status: 'completed',
      error_message: null,
      ...(resultUrl?.trim() ? { result_url: resultUrl.trim() } : {}),
      completed_at: new Date().toISOString(),
      ...(job?.job_type === 'post_blog' && published ? { image_urls: null } : {}),
    })
    .eq('id', jobId);

  if (job?.job_type === 'post_blog' && published && resultUrl?.trim() && job.account_id) {
    await recordPublishedPost({
      accountId: job.account_id as string,
      resultUrl,
      title: job.title as string | null,
      content: job.content as string | null,
      linkUrl: job.link_url as string | null,
      imageUrls: job.image_urls as string[] | null,
      publishedAt: new Date().toISOString(),
      workspace: job.workspace as string | null,
      hasVideo: job.content_type === 'B',
    });
  }

  scheduleWorkspaceQueueStatsRefresh(job?.workspace as string | null | undefined);
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
      }).then((telegram) => {
        rememberCaptchaTelegramOutbound(entry, telegram, resolveTelegramChatId(entry.workspace));
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
    const firstResume = setTimeout(() => {
      void tryAutoResumePostingCaptcha(entry);
    }, 600);
    entry.timers.push(firstResume);
  }

  const timeout = setTimeout(() => {
    void expireCaptchaHold(entry.jobId);
  }, entry.holdMs);
  entry.timers.push(timeout);

  const captchaPoll = setInterval(() => {
    void syncCaptchaHoldState(entry);
  }, CAPTCHA_HOLD_POLL_MS);
  entry.timers.push(captchaPoll);
}

async function tryAutoResumePostingCaptcha(entry: CaptchaHoldEntry): Promise<void> {
  if (!holds.has(entry.jobId) || entry.resumingInProgress || entry.autoResumeFiring) return;

  const page = pickPostingWorkflowPage(entry.context) ?? (await pickNaverCaptchaPage(entry.context));
  if (!page || page.isClosed()) return;
  if (await isNaverCaptchaVisible(page)) {
    await syncCaptchaHoldState(entry, page);
    return;
  }

  const url = page.url();
  if (url === 'about:blank' || url === '') return;

  if (await isPostingAutoResumeBlocked(page)) return;

  entry.autoResumeFiring = true;
  try {
    const sessionReady = await ensurePostingSessionAfterCaptcha(entry.context, entry.accountId, {
      allowAutoLoginSubmit: false,
    });
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

export function listCaptchaHoldTelegramOutboundForRegistry(): Array<{
  jobId: string;
  chatId: string;
  messageId: number;
}> {
  const rows: Array<{ jobId: string; chatId: string; messageId: number }> = [];
  for (const [jobId, entry] of holds) {
    if (entry.lastTelegramMessageId && entry.lastTelegramChatId) {
      rows.push({
        jobId,
        chatId: entry.lastTelegramChatId,
        messageId: entry.lastTelegramMessageId,
      });
    }
  }
  return rows;
}

function rememberCaptchaTelegramOutbound(
  entry: CaptchaHoldEntry,
  result: { ok?: boolean; messageId?: number; deliveryChatId?: string },
  envChatId: string | null,
): void {
  if (!result.ok || !result.messageId) return;
  entry.lastTelegramMessageId = result.messageId;
  entry.lastTelegramChatId = result.deliveryChatId ?? envChatId ?? undefined;
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
  if (msg.includes('NAVER_LOGIN_TIMEOUT:redirect')) return true;
  if (msg.includes('NAVER_LOGIN_BTN_CLICK_NO_SUBMIT')) return true;
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
    captchaRound: 1,
    captchaCurrentlyVisible: true,
    captchaClearedOnce: false,
  };
  holds.set(input.jobId, entry);
  scheduleReminders(entry);
  await focusVncBrowserPage(input.context, input.modemSession?.proxyPort);
  await consolidateNaverLoginTabs(input.context);

  const captchaPage = await pickNaverCaptchaPage(input.context);
  if (
    captchaPage &&
    !captchaPage.isClosed() &&
    captchaPage.url().includes('nidlogin') &&
    !(await isNaverAuthChallengePage(captchaPage))
  ) {
    await ensureNaverLoginCredentialsForCaptcha(captchaPage, input.accountId, { fast: true }).catch(
      () => {},
    );
  }

  if (captchaPage && !captchaPage.isClosed()) {
    await syncCaptchaHoldState(entry, captchaPage, {
      captureScreenshot: true,
    });
  }

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
    screenshotPath: entry.screenshotPath,
  });
  rememberCaptchaTelegramOutbound(entry, telegram, resolveTelegramChatId(input.workspace));

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
        if (job.job_type === 'post_blog') {
          const { data: jobRow } = await supabase.from('huma_jobs').select('*').eq('id', jobId).maybeSingle();
          if (jobRow) {
            await logOperation({
              level: 'warn',
              message: '[post_blog] CAPTCHA hold 소실 — DB payload로 재큐 (브라우저 세션 없음)',
              job_id: jobId,
              account_id: job.account_id,
            });
          }
        }
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
  } else if (entry.jobType === 'post_blog') {
    const postPayload =
      entry.payload ??
      (await supabase
        .from('huma_jobs')
        .select('title, content, image_urls, link_url, hashtags, workspace, content_type, platform_schedule, video_path')
        .eq('id', jobId)
        .maybeSingle()
        .then(({ data }) => (data ? buildPostBlogPayloadFromJob(data) : undefined)));

    if (postPayload) {
      const wfPage = pickPostingWorkflowPage(entry.context) ?? (await pickNaverCaptchaPage(entry.context));
      if (wfPage && !wfPage.isClosed() && (await isNaverCaptchaVisible(wfPage))) {
        entry.resumingInProgress = false;
        holds.set(jobId, entry);
        scheduleReminders(entry);
        return { ok: false, error: 'CAPTCHA_STILL_VISIBLE' };
      }

      const sessionOk = await ensurePostingSessionAfterCaptcha(entry.context, entry.accountId, {
        allowAutoLoginSubmit: false,
        loginWaitMs: 30_000,
      }).catch(() => false);
      if (!sessionOk) {
        entry.resumingInProgress = false;
        holds.set(jobId, entry);
        scheduleReminders(entry);
        const nidPage = await pickNaverCaptchaPage(entry.context);
        if (nidPage && (await isNaverAuthChallengePage(nidPage))) {
          return { ok: false, error: 'NAVER_LOGIN_2FA' };
        }
        if (nidPage?.url().includes('nidlogin') && (await isNaverLoginPendingAfterCaptcha(nidPage))) {
          return { ok: false, error: 'CAPTCHA_PENDING_LOGIN' };
        }
        return { ok: false, error: 'CAPTCHA_LOGIN_NOT_READY' };
      }
      await persistPostingSessionBeforeHoldClose(entry.context).catch(() => {});

      const cont = await continuePostBlogFromCaptchaHold({
        jobId,
        accountId,
        context: entry.context,
        modemSession: entry.modemSession,
        payload: postPayload,
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
    } else {
      await persistPostingSessionBeforeHoldClose(entry.context).catch(() => {});
      await closeBrowserContext(entry.context).catch(() => {});
      if (entry.modemSession) await releaseModem(entry.modemSession).catch(() => {});
      entry.releaseAccountLock();
      await resumePostingAfterCaptcha(jobId, accountId);
    }
  } else if (entry.jobType === 'cafe_new_post') {
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

  if (holdMeta.isDrill) {
    await notifyCaptchaTelegram({
      jobId,
      workspace: holdMeta.workspace,
      accountLabel: holdMeta.accountLabel,
      jobTitle: holdMeta.jobTitle,
      jobType: holdMeta.jobType,
      completed: true,
      drill: true,
      force: true,
    }).catch(() => {});
  }

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
  captchaScreenshotUpdatedAt?: number;
  hasCaptchaScreenshot?: boolean;
  captchaRound?: number;
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
    captchaScreenshotUpdatedAt: entry.screenshotUpdatedAt,
    hasCaptchaScreenshot: Boolean(entry.screenshotPath),
    captchaRound: entry.captchaRound,
  };
}
