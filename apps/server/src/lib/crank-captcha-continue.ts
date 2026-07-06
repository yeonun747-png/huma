import type { BrowserContext } from 'playwright';

import { supabase } from '../middleware/auth.js';
import { logOperation } from './log-emitter.js';
import { closeBrowserContext } from '../modules/playwright/browser.js';
import { releaseModem, type ModemSession } from '../modules/proxy/manager.js';
import { runSocialCrank } from '../modules/playwright/naver/social.js';
import { isNaverCaptchaVisible, pickNaverCaptchaPage } from './naver-captcha-vision.js';
import {
  ensureCrankSessionAfterCaptcha,
  isNaverAuthChallengePage,
  isNaverLoginPagePendingSubmit,
  pickPostingWorkflowPage,
} from './posting-captcha-session.js';
import { shouldPreserveBrowserPageForVnc } from '../modules/watcher/captcha-hold.js';
import {
  handleNaverAccountProtection,
  handleNaverAuthChallenge,
  isNaverAccountProtectionError,
  isNaverAuthChallengeError,
  NAVER_ACCOUNT_PROTECTED,
  parseNaverAccountProtectionPhase,
  parseNaverAuthChallengeKind,
} from './naver-account-protection.js';

function parseSocialCrankContent(content?: string | null): Record<string, unknown> {
  if (!content?.trim()) return {};
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    if (parsed && typeof parsed === 'object') return parsed;
  } catch {
    /* plain text */
  }
  return {};
}

/**
 * CAPTCHA hold — 동일 브라우저·로그인 세션 유지한 채 social_crank 이어하기.
 * 재로그인(naverLogin) 금지 — 새 탭+캡차 재발생 원인.
 */
export async function continueSocialCrankFromCaptchaHold(params: {
  jobId: string;
  accountId: string;
  context: BrowserContext;
  modemSession?: ModemSession;
  releaseAccountLock: () => void;
  workspace?: string | null;
  accountLabel?: string;
  jobTitle?: string;
}): Promise<{ ok: boolean; error?: string; reHeld?: boolean }> {
  const {
    jobId,
    accountId,
    context,
    modemSession,
    releaseAccountLock,
    workspace,
    accountLabel,
    jobTitle,
  } = params;

  let preserveBrowserSession = false;

  try {
    await supabase
      .from('huma_jobs')
      .update({
        status: 'running',
        error_message: null,
        started_at: new Date().toISOString(),
        advance_requested_at: null,
      })
      .eq('id', jobId);

    const { data: job } = await supabase.from('huma_jobs').select('content').eq('id', jobId).single();
    const content = parseSocialCrankContent(job?.content);
    const ourBlogUrls = Array.isArray(content.ourBlogUrls)
      ? (content.ourBlogUrls as string[])
      : undefined;

    const wfPage = pickPostingWorkflowPage(context) ?? (await pickNaverCaptchaPage(context));
    if (wfPage && !wfPage.isClosed() && (await isNaverCaptchaVisible(wfPage))) {
      return { ok: false, error: 'CAPTCHA_STILL_VISIBLE' };
    }

    const sessionOk = await ensureCrankSessionAfterCaptcha(context, accountId, {
      loginWaitMs: 30_000,
    }).catch(() => false);
    if (!sessionOk) {
      const nidPage = await pickNaverCaptchaPage(context);
      if (nidPage && (await isNaverAuthChallengePage(nidPage))) {
        await handleNaverAuthChallenge({
          accountId,
          workspace,
          humaJobId: jobId,
          kind: parseNaverAuthChallengeKind(new Error('NAVER_LOGIN_2FA')),
        }).catch((handlerErr) => {
          console.error('[naver] auth-challenge handler:', (handlerErr as Error).message);
        });
        return { ok: false, error: 'NAVER_LOGIN_2FA' };
      }
      if (nidPage?.url().includes('nidlogin') && (await isNaverLoginPagePendingSubmit(nidPage))) {
        return { ok: false, error: 'CAPTCHA_PENDING_LOGIN' };
      }
      return { ok: false, error: 'CAPTCHA_LOGIN_NOT_READY' };
    }

    try {
      await runSocialCrank(
        accountId,
        { ourBlogUrls, resumeAfterCaptcha: true },
        {
          humaJobId: jobId,
          modemSession,
          skipModemAcquire: true,
          existingContext: context,
          preserveContext: true,
          releaseAccountLock,
        },
      );
    } catch (runErr) {
      if (isNaverAuthChallengeError(runErr)) {
        await handleNaverAuthChallenge({
          accountId,
          workspace,
          humaJobId: jobId,
          kind: parseNaverAuthChallengeKind(runErr),
        }).catch((handlerErr) => {
          console.error('[naver] auth-challenge handler:', (handlerErr as Error).message);
        });
        await supabase
          .from('huma_jobs')
          .update({ status: 'failed', error_message: (runErr as Error).message, started_at: null })
          .eq('id', jobId);
        return { ok: false, error: (runErr as Error).message };
      }

      if (shouldPreserveBrowserPageForVnc(runErr) && !isNaverAuthChallengeError(runErr)) {
        preserveBrowserSession = true;
        const { enterCaptchaHold } = await import('../modules/watcher/captcha-hold.js');
        await logOperation({
          level: 'warn',
          message: '[social_crank] CAPTCHA 후 활동 중 캡차 재발 — hold 재진입',
          job_id: jobId,
          account_id: accountId,
        });
        await enterCaptchaHold({
          jobId,
          accountId,
          workspace,
          accountLabel,
          jobTitle,
          jobType: 'social_crank',
          context,
          modemSession,
          releaseAccountLock,
        });
        return { ok: true, reHeld: true };
      }
      throw runErr;
    }

    await supabase
      .from('huma_jobs')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        error_message: null,
      })
      .eq('id', jobId);

    await logOperation({
      level: 'info',
      message: '[social_crank] CAPTCHA 해결 후 동일 세션 활동 완료',
      job_id: jobId,
      account_id: accountId,
    });

    return { ok: true };
  } catch (err) {
    if (isNaverAccountProtectionError(err)) {
      await handleNaverAccountProtection({
        accountId,
        workspace,
        phase: parseNaverAccountProtectionPhase(err),
        humaJobId: jobId,
      }).catch((handlerErr) => {
        console.error('[naver] protection handler:', (handlerErr as Error).message);
      });
      return { ok: false, error: (err as Error).message ?? NAVER_ACCOUNT_PROTECTED };
    }
    const message = (err as Error).message ?? 'social_crank_continue_failed';
    await supabase
      .from('huma_jobs')
      .update({ status: 'failed', error_message: message, started_at: null })
      .eq('id', jobId);
    await logOperation({
      level: 'ERROR',
      message: `[social_crank] CAPTCHA 후 활동 실패: ${message}`,
      job_id: jobId,
      account_id: accountId,
    });
    return { ok: false, error: message };
  } finally {
    if (!preserveBrowserSession) {
      await closeBrowserContext(context).catch(() => {});
      if (modemSession) await releaseModem(modemSession).catch(() => {});
      releaseAccountLock();
    }
  }
}
