import type { BrowserContext, Page } from 'playwright';

import { humanSleep } from '../modules/human-engine/typing.js';
import { isNaverCaptchaVisible, pickNaverCaptchaPage } from './naver-captcha-vision.js';
import { vncFastSleepScale } from './vnc-session.js';

const NAV_MS = 60_000;

function scaleMs(min: number, max: number): [number, number] {
  const s = vncFastSleepScale();
  return [Math.round(min * s), Math.round(max * s)];
}

/** CAPTCHA hold 종료 전 — 로그인 리다이렉트·blog 방문으로 프로필 쿠키 저장 */
export async function persistPostingSessionBeforeHoldClose(context: BrowserContext): Promise<void> {
  const page = pickNaverCaptchaPage(context) ?? context.pages().find((p) => !p.isClosed());
  if (!page) return;

  if (await isNaverCaptchaVisible(page)) return;

  if (page.url().includes('nidlogin.login')) {
    await page
      .waitForURL((url) => !url.href.includes('nidlogin.login'), { timeout: 20_000 })
      .catch(() => {});
  }

  await page.goto('https://blog.naver.com', { waitUntil: 'domcontentloaded', timeout: NAV_MS }).catch(() => {});
  await humanSleep(...scaleMs(800, 1800));
}

export async function isBlogWriteReady(page: Page): Promise<boolean> {
  const writeBtn = page.locator('.btn_write, [class*="write"]').first();
  if ((await writeBtn.count().catch(() => 0)) === 0) return false;
  return writeBtn.isVisible({ timeout: 3000 }).catch(() => false);
}

/** VNC CAPTCHA 해결 직후 — naver.com 홈·워밍업 없이 blog.naver.com 글쓰기 가능 여부만 확인 */
export async function probeBlogSessionAfterCaptcha(context: BrowserContext): Promise<boolean> {
  const page = await context.newPage().catch(() => null);
  if (!page) return false;
  try {
    await page.goto('https://blog.naver.com', { waitUntil: 'domcontentloaded', timeout: NAV_MS });
    await humanSleep(...scaleMs(400, 900));
    return await isBlogWriteReady(page);
  } catch {
    return false;
  } finally {
    await page.close().catch(() => {});
  }
}
