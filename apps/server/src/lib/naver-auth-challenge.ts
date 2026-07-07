import type { Page } from 'playwright';

/** 2단계·기기인증 등 — 자동 클릭·입력·탭 전환 전부 금지 (VNC 수동) */
export async function isNaverAuthChallengePage(page: Page): Promise<boolean> {
  const url = page.url().toLowerCase();
  if (!url.includes('naver.com')) return false;

  if (
    url.includes('otp') ||
    url.includes('device') ||
    url.includes('new_env') ||
    url.includes('2step') ||
    url.includes('certify') ||
    url.includes('loginpolicy') ||
    url.includes('/login/ext/') ||
    url.includes('authkey')
  ) {
    return true;
  }

  const otpInput = page
    .locator(
      '#otp, input[name="otp"], input[placeholder*="인증번호"], input[placeholder*="OTP"], [class*="two_step"], [class*="TwoStep"]',
    )
    .first();
  if (await otpInput.isVisible({ timeout: 350 }).catch(() => false)) {
    const idVisible = await page.locator('#id').isVisible({ timeout: 200 }).catch(() => false);
    if (!idVisible) return true;
  }

  const body = await page.locator('body').innerText({ timeout: 1500 }).catch(() => '');
  if (
    !/2단계|2\s*단계|인증번호|새로운 기기|기기 등록|휴대폰 인증|본인 확인|알림을 확인|스마트\s*폰/.test(
      body,
    )
  ) {
    return false;
  }

  const idVisible = await page.locator('#id').isVisible({ timeout: 200 }).catch(() => false);
  const pwVisible = await page.locator('#pw').isVisible({ timeout: 200 }).catch(() => false);
  const captchaVisible = await page
    .locator('#captcha, #captchaimg, #cptch, .captcha_wrap, [id*="captcha"], .captcha')
    .first()
    .isVisible({ timeout: 200 })
    .catch(() => false);

  if (idVisible && pwVisible && captchaVisible) return false;
  if (idVisible && pwVisible && /로그인/.test(body) && !/2단계\s*인증/.test(body)) return false;

  return true;
}
