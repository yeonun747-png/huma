import type { Page } from 'playwright';

/** 2단계·기기인증 등 — 자동 클릭·로그인 제출 금지 (VNC 수동) */
export async function isNaverAuthChallengePage(page: Page): Promise<boolean> {
  const url = page.url().toLowerCase();
  if (
    url.includes('otp') ||
    url.includes('device') ||
    url.includes('new_env') ||
    url.includes('2step') ||
    url.includes('certify') ||
    url.includes('loginpolicy')
  ) {
    return true;
  }
  const body = await page.locator('body').innerText({ timeout: 2500 }).catch(() => '');
  return /2단계|2\s*단계|인증번호|새로운 기기|기기 등록|휴대폰 인증|본인 확인|알림을 확인/.test(body);
}
