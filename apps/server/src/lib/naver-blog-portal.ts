import type { Page } from 'playwright';

import { sleep } from './utils.js';
import { PLAYWRIGHT_NAV_TIMEOUT_MS } from './playwright-nav-timeout.js';

/** 블로그 발행·세션 확인용 — section.blog BlogHome 피드 회피 */
export const NAVER_BLOG_PORTAL_URL = 'https://blog.naver.com';

export function isBlogHomeFeedUrl(url: string): boolean {
  return url.includes('section.blog.naver.com') || /BlogHome\.naver/i.test(url);
}

function scaleMs(min: number, max: number): [number, number] {
  return [min, max];
}

/** BlogHome·빈 로딩 SPA — commit까지만 기다리고 blog.naver.com 포털로 이탈 */
export async function gotoBlogPortal(page: Page, timeoutMs = PLAYWRIGHT_NAV_TIMEOUT_MS): Promise<void> {
  const current = page.url();
  if (isBlogHomeFeedUrl(current)) {
    await page.goto('about:blank', { waitUntil: 'commit', timeout: 12_000 }).catch(() => {});
    await sleep(350);
  }

  await page.goto(NAVER_BLOG_PORTAL_URL, { waitUntil: 'commit', timeout: timeoutMs });

  for (let i = 0; i < 16; i += 1) {
    const textLen = await page
      .locator('body')
      .textContent({ timeout: 2000 })
      .then((t) => (t ?? '').trim().length)
      .catch(() => 0);
    if (textLen > 120) return;
    if (i === 8 && textLen < 40) {
      await page.reload({ waitUntil: 'commit', timeout: timeoutMs }).catch(() => {});
    }
    await sleep(650);
  }
}

/** 로그인 리다이렉트가 BlogHome으로 떨어지면 즉시 포털로 */
export async function escapeBlogHomeAfterLogin(page: Page): Promise<void> {
  if (!isBlogHomeFeedUrl(page.url())) return;
  await gotoBlogPortal(page);
}
