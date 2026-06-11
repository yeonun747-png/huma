import type { BrowserContext } from 'playwright';

import { enterCaptchaHold } from '../modules/watcher/captcha-hold.js';
import {
  handleLayer4Detection,
  isBlockError,
  isCaptchaError,
} from '../modules/watcher/detector.js';
import type { ModemSession } from '../modules/proxy/manager.js';
import { clickNaverLoginButton } from './naver-login-fields.js';
import { pickNaverCaptchaPage, tryAutoSolveNaverCaptcha } from './naver-captcha-vision.js';
import { setCrankSessionProgress } from './crank-session-progress.js';

/** worker·scheduled-session — CAPTCHA hold 진입 후 정상 종료 신호 */
export const CAPTCHA_AWAITING_HUMAN = 'CAPTCHA_AWAITING_HUMAN';

export function isCrankCaptchaHoldSignal(err: unknown): boolean {
  return (err as Error)?.message === CAPTCHA_AWAITING_HUMAN;
}

/** VNC에서 운영자가 직접 풀 수 있는 네이버 보안·인증 오류 */
export function isCrankHumanHoldError(err: unknown): boolean {
  const msg = (err as Error)?.message ?? '';
  if (isCaptchaError(err) || isBlockError(err)) return true;
  if (msg.includes('NAVER_LOGIN_2FA')) return true;
  if (msg.includes('NAVER_LOGIN_DEVICE_VERIFY')) return true;
  if (msg.includes('reason=block_captcha')) return true;
  if (msg.includes('NAVER_LOGIN_FAILED:redirect_stuck')) return true;
  if (msg.includes('HUMAN_CLICK_NO_BBOX')) return true;
  return false;
}

export type CrankCaptchaHoldParams = {
  err: unknown;
  humaJobId?: string;
  accountId: string;
  workspace: string;
  context: BrowserContext;
  modemSession?: ModemSession;
  releaseAccountLock?: () => void;
};

/**
 * C-Rank — 캡차·2FA·기기인증 등 VNC 수동 해결 (포스팅 CAPTCHA hold와 동일).
 * 성공 시 브라우저·동글 유지, job → awaiting_captcha.
 */
export async function tryEnterCrankCaptchaHold(params: CrankCaptchaHoldParams): Promise<boolean> {
  if (!params.humaJobId || !isCrankHumanHoldError(params.err)) return false;

  const errMsg = (params.err as Error)?.message ?? '';
  let visionAutoFailed = false;
  const captchaPage = pickNaverCaptchaPage(params.context);
  const shouldRetryVision =
    isCaptchaError(params.err) ||
    (Boolean(captchaPage) && errMsg.includes('HUMAN_CLICK_NO_BBOX'));

  if (shouldRetryVision) {
    const page = captchaPage;
    if (page) {
      const vision = await tryAutoSolveNaverCaptcha(page, {
        humaJobId: params.humaJobId,
        accountId: params.accountId,
        workspace: params.workspace,
        jobType: 'social_crank',
        resubmit: async () => {
          if (page.url().includes('nidlogin')) await clickNaverLoginButton(page);
        },
      });
      if (vision === 'solved') return false;
      if (vision === 'failed') visionAutoFailed = true;
    }
  }

  await handleLayer4Detection(params.accountId, params.err, params.modemSession, {
    skipExternalNotify: true,
    workspace: params.workspace,
  });

  await setCrankSessionProgress(
    params.humaJobId,
    'CAPTCHA 대기',
    visionAutoFailed ? 'Vision 3회 실패 · VNC' : 'VNC 수동 해결',
  );

  await enterCaptchaHold({
    jobId: params.humaJobId,
    accountId: params.accountId,
    workspace: params.workspace,
    jobTitle: 'C-Rank 소통',
    jobType: 'social_crank',
    context: params.context,
    modemSession: params.modemSession,
    releaseAccountLock: params.releaseAccountLock ?? (() => {}),
    visionAutoFailed,
  });

  return true;
}
