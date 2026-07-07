import type { BrowserContext } from 'playwright';

import { enterCaptchaHold } from '../modules/watcher/captcha-hold.js';
import { isNaverAuthChallengeError } from './naver-account-protection.js';
import {
  handleLayer4Detection,
  isCaptchaError,
  isNaverHumanHoldError,
} from '../modules/watcher/detector.js';
import type { ModemSession } from '../modules/proxy/manager.js';
import { pickNaverCaptchaPage, shouldNotifyVisionAutoFailed, tryAutoSolveNaverCaptcha } from './naver-captcha-vision.js';
import { isNaverLoginPagePendingSubmit } from './posting-captcha-session.js';
import { setCrankSessionProgress } from './crank-session-progress.js';

/** worker·scheduled-session — CAPTCHA hold 진입 후 정상 종료 신호 */
export const CAPTCHA_AWAITING_HUMAN = 'CAPTCHA_AWAITING_HUMAN';

export function isCrankCaptchaHoldSignal(err: unknown): boolean {
  return (err as Error)?.message === CAPTCHA_AWAITING_HUMAN;
}

/** VNC에서 운영자가 직접 풀 수 있는 네이버 보안·인증 오류 */
export function isCrankHumanHoldError(err: unknown): boolean {
  return isNaverHumanHoldError(err);
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
  if (isNaverAuthChallengeError(params.err)) return false;

  const errMsg = (params.err as Error)?.message ?? '';
  let visionAutoFailed = false;
  let visionAttempts = 0;
  let visionFailureReason: import('./naver-captcha-vision.js').CaptchaVisionFailureReason | undefined;
  const captchaPage = await pickNaverCaptchaPage(params.context);
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
      });
      visionAttempts = vision.attempts;
      visionFailureReason = vision.failureReason;
      if (vision.result === 'solved' && !(await isNaverLoginPagePendingSubmit(page))) return false;
      if (shouldNotifyVisionAutoFailed(vision)) visionAutoFailed = true;
    }
  }

  await handleLayer4Detection(params.accountId, params.err, params.modemSession, {
    skipExternalNotify: true,
    workspace: params.workspace,
    skipAccountPause: true,
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
    visionAttempts,
    visionFailureReason,
  });

  return true;
}
