import {
  completeCaptchaHold,
  getCaptchaHold,
  syncCaptchaHoldState,
} from '../modules/watcher/captcha-hold.js';
import {
  applyManualCaptchaAnswer,
  isNaverCaptchaVisible,
  pickNaverCaptchaPage,
} from './naver-captcha-vision.js';
import { ensurePostingSessionAfterCaptcha } from './posting-captcha-session.js';

export type CaptchaAnswerSubmitResult = {
  ok: boolean;
  error?: string;
  submitted?: boolean;
  captcha_cleared?: boolean;
  pending_login?: boolean;
  captcha_still_visible?: boolean;
};

/** 웹·텔레그램 공통 — CAPTCHA 수동 정답 원격 입력 */
export async function submitCaptchaAnswerForJob(
  jobId: string,
  answer: string,
): Promise<CaptchaAnswerSubmitResult> {
  const hold = getCaptchaHold(jobId);
  if (!hold) {
    return { ok: false, error: 'CAPTCHA 세션이 없습니다 (만료·종료됨)' };
  }

  const page = await pickNaverCaptchaPage(hold.context);
  if (!page || page.isClosed()) {
    return { ok: false, error: '브라우저 페이지가 닫혔습니다' };
  }
  if (!(await isNaverCaptchaVisible(page))) {
    return {
      ok: false,
      error: 'CAPTCHA 화면이 아닙니다 — 이미 해결됐다면 발행 재개를 누르세요',
    };
  }

  const result = await applyManualCaptchaAnswer(page, answer, {
    accountId: hold.accountId,
    humaJobId: jobId,
    workspace: hold.workspace,
    jobType: hold.jobType,
  });
  if (!result.filled) {
    return { ok: false, error: 'CAPTCHA 입력칸을 찾지 못했습니다' };
  }

  if (await isNaverCaptchaVisible(page)) {
    await syncCaptchaHoldState(hold, page, {
      treatAsSecondRound: !result.cleared,
      captureScreenshot: true,
      refillPassword: true,
    });
  }

  const captchaStillVisible = await isNaverCaptchaVisible(page);

  if (
    result.cleared &&
    !result.pending_login &&
    (hold.jobType === 'post_blog' || hold.jobType === 'cafe_new_post')
  ) {
    void (async () => {
      const ready = await ensurePostingSessionAfterCaptcha(hold.context, hold.accountId, {
        allowAutoLoginSubmit: false,
      }).catch(() => false);
      if (ready) await completeCaptchaHold(jobId);
    })();
  }

  return {
    ok: true,
    submitted: result.submitted,
    captcha_cleared: result.cleared,
    pending_login: result.pending_login,
    captcha_still_visible: captchaStillVisible,
  };
}
