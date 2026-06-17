import type { BrowserContext, Page } from 'playwright';

import { humanSleep } from '../modules/human-engine/typing.js';
import { submitNaverLoginAfterCaptcha } from './naver-login-fields.js';
import { isNaverAuthChallengePage } from './naver-auth-challenge.js';
import { isNaverCaptchaVisible, pickNaverCaptchaPage } from './naver-captcha-vision.js';
import { gotoBlogPortal, waitForBlogPortalReady } from './naver-blog-portal.js';
import { findNaverPostwritePage } from '../modules/playwright/naver/enter-blog-editor.js';
import { sleep } from './utils.js';
import { vncFastSleepScale } from './vnc-session.js';

/** CAPTCHA hold — VNC 수동 로그인 클릭 직후 감지 주기 */
export const POSTING_LOGIN_POLL_MS = 800;

const LOGGED_IN_CSS =
  'a[href*="nidlogout"], a[href*="nidlogin.logout"], .gnb_my, #account, [class*="MyView"]';

function scaleMs(min: number, max: number): [number, number] {
  const s = vncFastSleepScale();
  return [Math.round(min * s), Math.round(max * s)];
}

function scoreWorkflowPageUrl(url: string): number {
  if (url === 'about:blank' || url === '' || url === 'chrome://newtab/') return 0;
  if (url.includes('postwrite') || url.includes('PostWrite')) return 130;
  if (url.includes('blog.naver.com') && !url.includes('section.blog')) return 110;
  if (url.includes('section.blog.naver.com') || /BlogHome/i.test(url)) return 85;
  if (url.includes('www.naver.com') && !url.includes('nidlogin')) return 70;
  if (url.includes('nidlogin')) return 25;
  if (url.includes('search.naver.com') || url.includes('dict.naver.com')) return 5;
  if (url.includes('naver.com')) return 40;
  return 5;
}

export function pickPostingWorkflowPage(context: BrowserContext): Page | undefined {
  const postwrite = findNaverPostwritePage(context);
  if (postwrite) return postwrite;

  const pages = context.pages().filter((p) => !p.isClosed());
  const ranked = pages
    .map((page) => ({ page, score: scoreWorkflowPageUrl(page.url()) }))
    .sort((a, b) => b.score - a.score);
  return ranked[0]?.score ? ranked[0].page : pages[0];
}

export { isNaverAuthChallengePage } from './naver-auth-challenge.js';

/** 로그인 완료 — 긍정 지표(로그아웃·MY·글쓰기) 확인. 로딩 중 오판 방지 */
export async function isNaverLoggedInOnPage(page: Page): Promise<boolean> {
  const url = page.url();
  if (url === 'about:blank' || url === '' || !url.includes('naver.com')) return false;
  if (url.includes('nidlogin')) return false;

  if (await isNaverCaptchaVisible(page)) return false;
  if (await isNaverAuthChallengePage(page)) return false;

  if (await page.locator(LOGGED_IN_CSS).first().isVisible({ timeout: 600 }).catch(() => false)) {
    return true;
  }

  if (url.includes('blog.naver.com') || url.includes('section.blog')) {
    const state = await waitForBlogPortalReady(page, 4000);
    return state === 'write_ready';
  }

  if (url.includes('www.naver.com')) {
    await page.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => {});
    if (await page.locator(LOGGED_IN_CSS).first().isVisible({ timeout: 1000 }).catch(() => false)) {
      return true;
    }
    const loginLink = page.locator('a[href*="nidlogin.login"], a.link_login').first();
    if (await loginLink.isVisible({ timeout: 800 }).catch(() => false)) return false;
    return false;
  }

  const loginLink = page.locator('a[href*="nidlogin.login"], a.link_login').first();
  if (await loginLink.isVisible({ timeout: 500 }).catch(() => false)) return false;
  return false;
}

/**
 * 발행 재개 가능 상태 — 로그인만 확인한다.
 * 에디터 진입은 enterBlogEditor 가 공식 글쓰기 URL(blog.naver.com/{id}/postwrite)로
 * 직접 이동하므로, 여기서는 "캡차·로그인 화면이 아니고 네이버에 로그인된 상태"인지만 본다.
 */
export async function isBlogWriteReady(page: Page): Promise<boolean> {
  return isNaverLoggedInOnPage(page);
}

/** nid 로그인 화면 — 캡차는 풀렸지만 로그인 버튼 미클릭(VNC 수동 제출 대기) */
export async function isNaverLoginPagePendingSubmit(page: Page): Promise<boolean> {
  if (await isNaverAuthChallengePage(page)) return true;
  if (page.url().includes('nidlogin')) return true;

  const loginBtn = page
    .locator('#log\\.login, button.btn_login, input.btn_login, .btn_login, button[type="submit"]')
    .first();
  return loginBtn.isVisible({ timeout: 500 }).catch(() => false);
}

/** CAPTCHA hold 폴링 — 캡차·nid·로그인 미완료(메인 로딩) 시 재개 차단 */
export async function isPostingAutoResumeBlocked(page: Page): Promise<boolean> {
  if (await isNaverCaptchaVisible(page)) return true;
  if (await isNaverLoginPagePendingSubmit(page)) return true;
  if (await isNaverAuthChallengePage(page)) return true;
  const url = page.url();
  if (url.includes('naver.com') && !url.includes('nidlogin') && !(await isNaverLoggedInOnPage(page))) {
    return true;
  }
  return false;
}

/** naverLogin — nid 이탈 또는 캡차 즉시 감지 (VNC 수동 로그인 대기 포함) */
export async function pollUntilNaverLoginRedirect(
  page: Page,
  options: { timeoutMs: number; assertOk?: (page: Page) => Promise<void> },
): Promise<void> {
  const deadline = Date.now() + options.timeoutMs;
  while (Date.now() < deadline) {
    if (!page.url().includes('nidlogin.login')) {
      if (options.assertOk) await options.assertOk(page);
      return;
    }
    if (await isNaverCaptchaVisible(page)) {
      throw new Error('CAPTCHA_DETECTED');
    }
    if (await isNaverAuthChallengePage(page)) {
      throw new Error('NAVER_LOGIN_2FA');
    }
    await sleep(POSTING_LOGIN_POLL_MS);
  }
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  if (options.assertOk) await options.assertOk(page);
  if (!page.url().includes('nidlogin.login')) return;
  throw new Error('NAVER_LOGIN_TIMEOUT:redirect');
}

/** CAPTCHA hold 종료 전 — postwrite 탭이 있으면 생략(발행 재개 버튼과 동일·에디터 직행) */
export async function persistPostingSessionBeforeHoldClose(context: BrowserContext): Promise<void> {
  if (findNaverPostwritePage(context)) return;

  const page = pickPostingWorkflowPage(context) ?? (await pickNaverCaptchaPage(context));
  if (!page) return;

  if (await isNaverCaptchaVisible(page)) return;
  if (await isNaverAuthChallengePage(page)) return;

  if (page.url().includes('nidlogin.login')) {
    await page
      .waitForURL((u) => !u.href.includes('nidlogin.login'), { timeout: 20_000 })
      .catch(() => {});
  }

  await gotoBlogPortal(page).catch(() => {});
  await humanSleep(...scaleMs(800, 1800));
}

/** huma_jobs 행 → post_blog worker payload (hold 소실·재개 폴백) */
export function buildPostBlogPayloadFromJob(job: {
  title?: string | null;
  content?: string | null;
  image_urls?: string[] | null;
  link_url?: string | null;
  hashtags?: string[] | null;
  workspace?: string | null;
  content_type?: string | null;
  platform_schedule?: Record<string, unknown> | null;
  video_path?: string | null;
}): Record<string, unknown> {
  const workspace = job.workspace ?? 'yeonun';
  return {
    title: job.title,
    content: job.content,
    imageUrls: job.image_urls ?? [],
    hashtags: job.hashtags ?? [],
    workspace,
    contentType: job.content_type,
    platform_schedule: job.platform_schedule ?? undefined,
    video_path: job.video_path ?? undefined,
  };
}

/** 컨텍스트 내 로그인 완료 탭 탐색 */
async function findLoggedInPostingPage(context: BrowserContext): Promise<Page | undefined> {
  for (const page of context.pages().filter((p) => !p.isClosed())) {
    if (await isNaverLoggedInOnPage(page)) return page;
  }
  return undefined;
}

/**
 * CAPTCHA 해결 후 — 로그인 제출을 끝내고 로그인 상태만 확인한다.
 * (에디터 진입은 continuePostBlog → enterBlogEditor 가 직접 URL로 처리)
 */
export async function ensurePostingSessionAfterCaptcha(
  context: BrowserContext,
  accountId: string,
  options?: { allowAutoLoginSubmit?: boolean; loginWaitMs?: number },
): Promise<boolean> {
  const allowAutoLoginSubmit = options?.allowAutoLoginSubmit === true;

  const loggedIn = await findLoggedInPostingPage(context);
  if (loggedIn) {
    await persistPostingSessionBeforeHoldClose(context);
    return true;
  }

  let page = pickPostingWorkflowPage(context) ?? (await pickNaverCaptchaPage(context));
  if (!page || page.isClosed()) return false;

  const url = page.url();
  if (url === 'about:blank' || url === '') return false;

  if (await isNaverCaptchaVisible(page)) return false;
  if (await isNaverAuthChallengePage(page)) return false;

  if (allowAutoLoginSubmit && page.url().includes('nidlogin')) {
    await submitNaverLoginAfterCaptcha(page, accountId);
    await humanSleep(...scaleMs(800, 1500));
  } else if (page.url().includes('nidlogin')) {
    return false;
  }

  const probe = pickPostingWorkflowPage(context) ?? page;
  if (await isBlogWriteReady(probe)) {
    await persistPostingSessionBeforeHoldClose(context);
    return true;
  }

  await gotoBlogPortal(probe).catch(() => {});
  await humanSleep(...scaleMs(600, 1200));
  if (await isBlogWriteReady(probe)) {
    await persistPostingSessionBeforeHoldClose(context);
    return true;
  }

  return probeBlogSessionAfterCaptcha(context);
}

/** VNC CAPTCHA 해결 직후 — blog.naver.com 글쓰기 가능 여부만 확인 */
export async function probeBlogSessionAfterCaptcha(context: BrowserContext): Promise<boolean> {
  const page = await context.newPage().catch(() => null);
  if (!page) return false;
  try {
    await gotoBlogPortal(page);
    await humanSleep(...scaleMs(400, 900));
    const ready = await isBlogWriteReady(page);
    if (ready) {
      await persistPostingSessionBeforeHoldClose(context);
    }
    return ready;
  } catch {
    return false;
  } finally {
    await page.close().catch(() => {});
  }
}
