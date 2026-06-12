import type { BrowserContext, Page } from 'playwright';

import { resolveBlogLinkUrl } from './blog-link.js';
import { humanSleep } from '../modules/human-engine/typing.js';
import {
  clickNaverLoginButton,
  ensureNaverLoginCredentialsForCaptcha,
} from './naver-login-fields.js';
import { isNaverCaptchaVisible, pickNaverCaptchaPage } from './naver-captcha-vision.js';
import { gotoBlogPortal } from './naver-blog-portal.js';
import { vncFastSleepScale } from './vnc-session.js';

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
  if (url.includes('search.naver.com')) return 12;
  if (url.includes('naver.com')) return 40;
  return 5;
}

export function pickPostingWorkflowPage(context: BrowserContext): Page | undefined {
  const pages = context.pages().filter((p) => !p.isClosed());
  const ranked = pages
    .map((page) => ({ page, score: scoreWorkflowPageUrl(page.url()) }))
    .sort((a, b) => b.score - a.score);
  return ranked[0]?.score ? ranked[0].page : pages[0];
}

/** 2단계·기기인증 등 — 자동 재개·로그인 클릭 금지 */
export async function isNaverAuthChallengePage(page: Page): Promise<boolean> {
  const url = page.url().toLowerCase();
  if (
    url.includes('otp') ||
    url.includes('device') ||
    url.includes('new_env') ||
    url.includes('2step')
  ) {
    return true;
  }
  const body = await page.locator('body').innerText({ timeout: 2500 }).catch(() => '');
  return /2단계|인증번호|새로운 기기|기기 등록|휴대폰 인증|본인 확인/.test(body);
}

/**
 * 발행 재개 가능 상태 — 로그인만 확인한다.
 * 에디터 진입은 enterBlogEditor 가 공식 글쓰기 URL(blog.naver.com/{id}/postwrite)로
 * 직접 이동하므로, 여기서는 "캡차·로그인 화면이 아니고 네이버에 로그인된 상태"인지만 본다.
 */
export async function isBlogWriteReady(page: Page): Promise<boolean> {
  const url = page.url();
  if (url.includes('nidlogin') || url === 'about:blank' || url === '') return false;
  if (!url.includes('naver.com')) return false;

  if (await isNaverCaptchaVisible(page)) return false;
  if (await isNaverAuthChallengePage(page)) return false;

  const loginLink = page.locator('a[href*="nidlogin.login"], a.link_login').first();
  if (await loginLink.isVisible({ timeout: 1000 }).catch(() => false)) return false;

  return true;
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

/** 10초 폴링 자동 재개 차단 조건 */
export async function isPostingAutoResumeBlocked(page: Page): Promise<boolean> {
  if (await isNaverCaptchaVisible(page)) return true;
  if (await isNaverLoginPagePendingSubmit(page)) return true;
  if (await isNaverAuthChallengePage(page)) return true;
  return false;
}

/** CAPTCHA hold 종료 전 — 로그인 리다이렉트 완료·blog 방문으로 프로필 쿠키 저장 */
export async function persistPostingSessionBeforeHoldClose(context: BrowserContext): Promise<void> {
  const page = pickNaverCaptchaPage(context) ?? pickPostingWorkflowPage(context);
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
    linkUrl: resolveBlogLinkUrl(workspace, job.link_url, job.link_url),
    hashtags: job.hashtags ?? [],
    workspace,
    contentType: job.content_type,
    platform_schedule: job.platform_schedule ?? undefined,
    video_path: job.video_path ?? undefined,
  };
}

/**
 * CAPTCHA 해결 후 — 로그인 제출을 끝내고 로그인 상태만 확인한다.
 * (에디터 진입은 continuePostBlog → enterBlogEditor 가 직접 URL로 처리)
 */
export async function ensurePostingSessionAfterCaptcha(
  context: BrowserContext,
  accountId: string,
  options?: { allowAutoLoginSubmit?: boolean },
): Promise<boolean> {
  const allowAutoLoginSubmit = options?.allowAutoLoginSubmit === true;
  const page = pickNaverCaptchaPage(context) ?? pickPostingWorkflowPage(context);
  if (!page || page.isClosed()) return false;

  const url = page.url();
  if (url === 'about:blank' || url === '') return false;

  if (await isNaverCaptchaVisible(page)) return false;
  if (await isNaverAuthChallengePage(page)) return false;

  if (allowAutoLoginSubmit && page.url().includes('nidlogin.login')) {
    await ensureNaverLoginCredentialsForCaptcha(page, accountId, { fast: true });
    await clickNaverLoginButton(page);
    await page
      .waitForURL((u) => !u.href.includes('nidlogin.login'), { timeout: 25_000 })
      .catch(() => {});
    if (page.url().includes('nidlogin.login')) return false;
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
