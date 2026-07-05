import type { Locator, Page } from 'playwright';

import { humanClickLocatorFallback } from '../modules/human-engine/mouse.js';
import { sleep } from './utils.js';
import { PLAYWRIGHT_NAV_TIMEOUT_MS } from './playwright-nav-timeout.js';

/**
 * 네이버는 로그인 상태에서 blog.naver.com 접속 시 section.blog.naver.com/BlogHome.naver
 * 로 리다이렉트한다 — 이것이 정상 동작이다. BlogHome 은 SPA 라서 렌더 전에는 빈 화면이지만,
 * 렌더가 끝나면 우측 프로필 카드에 「내 블로그」·「글쓰기」 버튼이 표시된다.
 *
 * 따라서 BlogHome 을 "탈출"하면 안 된다(blog.naver.com 으로 재이동 → 다시 BlogHome
 * 리다이렉트 → 무한 루프). 렌더를 기다렸다가 글쓰기 진입점을 찾아 클릭한다.
 */
export const NAVER_BLOG_PORTAL_URL = 'https://blog.naver.com';

const navDebounceUntil = new WeakMap<Page, number>();

export function isBlogHomeFeedUrl(url: string): boolean {
  return url.includes('section.blog.naver.com') || /BlogHome\.naver/i.test(url);
}

function isBlankUrl(url: string): boolean {
  return url === 'about:blank' || url === '' || url === 'chrome://newtab/';
}

const WRITE_ENTRY_CSS = [
  '.btn_write',
  'a.btn_write',
  '[class*="btn_write"]',
  'a[href*="GoBlogWrite"]',
  'a[href*="Redirect=Write"]',
  'a[href*="postwrite"]',
].join(', ');

const LOGIN_LINK_CSS = 'a[href*="nidlogin.login"], a.link_login';

/** 글쓰기 진입점 1회 탐색 — 개인 블로그 .btn_write 또는 BlogHome 프로필 카드 「글쓰기」 */
async function probeWriteEntry(page: Page): Promise<Locator | null> {
  const css = page.locator(WRITE_ENTRY_CSS).first();
  if (await css.isVisible().catch(() => false)) return css;

  const textLink = page.locator('a:has-text("글쓰기"), button:has-text("글쓰기")').first();
  if (await textLink.isVisible().catch(() => false)) return textLink;

  return null;
}

/** 글쓰기 진입점이 보일 때까지 폴링 (SPA 렌더 대기) */
export async function findBlogWriteEntry(
  page: Page,
  timeoutMs = 10_000,
): Promise<Locator | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const entry = await probeWriteEntry(page);
    if (entry) return entry;
    if (Date.now() >= deadline || page.isClosed()) return null;
    await sleep(500);
  }
}

export type BlogPortalState = 'write_ready' | 'logged_out' | 'timeout';

/** BlogHome SPA 렌더 대기 — 글쓰기 진입점(로그인) 또는 로그인 링크(로그아웃)가 뜰 때까지 */
export async function waitForBlogPortalReady(
  page: Page,
  timeoutMs = 15_000,
): Promise<BlogPortalState> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await probeWriteEntry(page)) return 'write_ready';
    if (await page.locator(LOGIN_LINK_CSS).first().isVisible().catch(() => false)) {
      return 'logged_out';
    }
    if (Date.now() >= deadline || page.isClosed()) return 'timeout';
    await sleep(600);
  }
}

/**
 * www.naver.com — 상단 「블로그」 서비스 링크 클릭 우선, 실패 시 blog.naver.com goto
 */
async function reachBlogPortalFromPage(page: Page): Promise<BlogPortalState> {
  if (await probeWriteEntry(page)) return 'write_ready';

  const current = page.url();
  if (current.includes('www.naver.com') && !current.includes('nidlogin')) {
    const blogNav = page
      .locator(
        '.link_service:has-text("블로그"), a.link_service[href*="blog"], a[href*="section.blog.naver.com"]',
      )
      .first();
    if (await blogNav.isVisible({ timeout: 2500 }).catch(() => false)) {
      await humanClickLocatorFallback(page, blogNav, [140, 320]);
      await page.waitForLoadState('domcontentloaded', { timeout: PLAYWRIGHT_NAV_TIMEOUT_MS }).catch(() => {});
      const state = await waitForBlogPortalReady(page, 12_000);
      if (state !== 'timeout') return state;
    }
  }

  return gotoBlogPortal(page);
}

/**
 * 블로그 포털 보장 — 이미 글쓰기 진입점이 보이면 즉시 반환.
 * 블로그 도메인(BlogHome 포함)이면 네비게이션 없이 렌더만 대기.
 * 그 외 도메인일 때만 1회 goto (8초 debounce). 재-goto 루프 금지.
 */
export async function gotoBlogPortal(
  page: Page,
  timeoutMs = PLAYWRIGHT_NAV_TIMEOUT_MS,
): Promise<BlogPortalState> {
  if (await probeWriteEntry(page)) return 'write_ready';

  const current = page.url();
  if (!current.includes('blog.naver.com') || isBlankUrl(current)) {
    const now = Date.now();
    if (now >= (navDebounceUntil.get(page) ?? 0)) {
      navDebounceUntil.set(page, now + 8000);
      await page
        .goto(NAVER_BLOG_PORTAL_URL, { waitUntil: 'domcontentloaded', timeout: timeoutMs })
        .catch(() => {});
    }
  }

  return waitForBlogPortalReady(page);
}

/**
 * 글쓰기 진입점 확보 — 포털 렌더 대기 후에도 없으면 「내 블로그」(또는 계정 블로그 URL)로
 * 1회 폴백해 개인 블로그의 글쓰기 버튼을 찾는다. (사용자 수동 절차와 동일: 내 블로그 → 글쓰기)
 */
export async function ensureBlogWriteEntry(
  page: Page,
  personalBlogUrl?: string,
): Promise<Locator | null> {
  const state = await reachBlogPortalFromPage(page);
  if (state === 'write_ready') return probeWriteEntry(page);
  if (state === 'logged_out') return null;

  if (personalBlogUrl?.includes('blog.naver.com/')) {
    await page
      .goto(personalBlogUrl, { waitUntil: 'domcontentloaded', timeout: PLAYWRIGHT_NAV_TIMEOUT_MS })
      .catch(() => {});
    return findBlogWriteEntry(page, 10_000);
  }

  const myBlogLink = page
    .locator(
      'a:has-text("내 블로그"), a[href*="blog.naver.com/"]:not([href*="section.blog"]):not([href*="BlogHome"])',
    )
    .first();
  if (await myBlogLink.isVisible().catch(() => false)) {
    await humanClickLocatorFallback(page, myBlogLink, [120, 280]);
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    return findBlogWriteEntry(page, 10_000);
  }

  return null;
}

/** 로그인 리다이렉트가 BlogHome 으로 떨어진 경우 — 렌더만 대기 (네비게이션 금지) */
export async function escapeBlogHomeAfterLogin(page: Page): Promise<void> {
  if (!isBlogHomeFeedUrl(page.url())) return;
  await waitForBlogPortalReady(page);
}
