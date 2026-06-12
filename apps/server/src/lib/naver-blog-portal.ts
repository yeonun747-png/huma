import type { Page } from 'playwright';

import { sleep } from './utils.js';
import { PLAYWRIGHT_NAV_TIMEOUT_MS } from './playwright-nav-timeout.js';

/** 블로그 발행·세션 확인용 — section.blog BlogHome 피드 회피 */
export const NAVER_BLOG_PORTAL_URL = 'https://blog.naver.com';

const navDebounceUntil = new WeakMap<Page, number>();

export function isBlogHomeFeedUrl(url: string): boolean {
  return url.includes('section.blog.naver.com') || /BlogHome\.naver/i.test(url);
}

function isBlankUrl(url: string): boolean {
  return url === 'about:blank' || url === '' || url === 'chrome://newtab/';
}

async function hasWriteButton(page: Page): Promise<boolean> {
  return page
    .locator('.btn_write, a.btn_write, [class*="btn_write"]')
    .first()
    .isVisible({ timeout: 2000 })
    .catch(() => false);
}

/**
 * blog.naver.com 포털 — about:blank 경유 금지(BlogHome↔blank 무한 루프 방지).
 * 8초 이내 중복 goto 스킵.
 */
export async function gotoBlogPortal(page: Page, timeoutMs = PLAYWRIGHT_NAV_TIMEOUT_MS): Promise<void> {
  const now = Date.now();
  const until = navDebounceUntil.get(page) ?? 0;
  if (now < until) return;

  const current = page.url();
  if (!isBlogHomeFeedUrl(current) && !isBlankUrl(current) && current.includes('blog.naver.com')) {
    if (await hasWriteButton(page)) return;
  }

  navDebounceUntil.set(page, now + 8000);

  await page.goto(NAVER_BLOG_PORTAL_URL, { waitUntil: 'domcontentloaded', timeout: timeoutMs }).catch(() => {});

  if (isBlogHomeFeedUrl(page.url())) {
    await page.goto(NAVER_BLOG_PORTAL_URL, { waitUntil: 'domcontentloaded', timeout: timeoutMs }).catch(() => {});
  }

  for (let i = 0; i < 8; i += 1) {
    if (await hasWriteButton(page)) return;
    if (!isBlogHomeFeedUrl(page.url()) && !isBlankUrl(page.url())) return;
    await sleep(400);
  }
}

/** BlogHome 피드에서 글쓰기·내 블로그 링크로 이탈 (blog.naver.com 루트 리다이렉트 루프 방지) */
async function leaveBlogHomeFeed(page: Page, personalBlogUrl?: string): Promise<boolean> {
  if (await hasWriteButton(page)) return true;

  const writeLink = page
    .locator('a[href*="PostWrite"], a[href*="postwrite"], a.btn_write, .btn_write')
    .first();
  if (await writeLink.isVisible({ timeout: 2500 }).catch(() => false)) {
    await writeLink.click({ timeout: 8000 }).catch(() => {});
    await sleep(600);
    if (await hasWriteButton(page)) return true;
  }

  if (personalBlogUrl?.includes('blog.naver.com/')) {
    await page
      .goto(personalBlogUrl, { waitUntil: 'domcontentloaded', timeout: PLAYWRIGHT_NAV_TIMEOUT_MS })
      .catch(() => {});
    await sleep(500);
    if (!isBlogHomeFeedUrl(page.url()) && (await hasWriteButton(page))) return true;
  }

  const myBlog = page
    .locator('a[href*="blog.naver.com/"]:not([href*="BlogHome"]):not([href*="section.blog"])')
    .first();
  if (await myBlog.isVisible({ timeout: 2000 }).catch(() => false)) {
    await myBlog.click({ timeout: 8000 }).catch(() => {});
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    if (!isBlogHomeFeedUrl(page.url()) && (await hasWriteButton(page))) return true;
  }

  return false;
}

/** 로그인 리다이렉트가 BlogHome으로 떨어지면 포털로 (about:blank 사용 안 함) */
export async function escapeBlogHomeAfterLogin(
  page: Page,
  personalBlogUrl?: string,
): Promise<void> {
  if (!isBlogHomeFeedUrl(page.url())) return;
  if (await leaveBlogHomeFeed(page, personalBlogUrl)) return;
  await gotoBlogPortal(page);
}
