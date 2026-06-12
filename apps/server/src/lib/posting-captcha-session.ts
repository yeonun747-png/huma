import type { BrowserContext, Page } from 'playwright';

import { supabase } from '../middleware/auth.js';
import { humanSleep } from '../modules/human-engine/typing.js';
import {
  clickNaverLoginButton,
  ensureNaverLoginCredentialsForCaptcha,
} from './naver-login-fields.js';
import { isNaverCaptchaVisible, pickNaverCaptchaPage } from './naver-captcha-vision.js';
import { ensureBlogWriteEntry, findBlogWriteEntry, gotoBlogPortal } from './naver-blog-portal.js';
import { vncFastSleepScale } from './vnc-session.js';

function scaleMs(min: number, max: number): [number, number] {
  const s = vncFastSleepScale();
  return [Math.round(min * s), Math.round(max * s)];
}

async function loadAccountBlogUrl(accountId: string): Promise<string | undefined> {
  const { data } = await supabase
    .from('huma_accounts')
    .select('blog_url, naver_id')
    .eq('id', accountId)
    .maybeSingle();
  const fromDb = (data?.blog_url as string | undefined)?.trim();
  if (fromDb?.includes('blog.naver.com/')) return fromDb;
  const nid = (data?.naver_id as string | undefined)?.trim();
  if (nid) return `https://blog.naver.com/${nid}`;
  return undefined;
}

export function pickPostingWorkflowPage(context: BrowserContext): Page | undefined {
  const pages = context.pages().filter((p) => !p.isClosed());
  const ranked = pages
    .map((page) => {
      const url = page.url();
      if (url.includes('nidlogin') || url.includes('about:blank') || url === '') return { page, score: 0 };
      if (url.includes('postwrite') || url.includes('PostWrite')) return { page, score: 120 };
      if (url.includes('blog.naver.com') && !url.includes('section.blog')) return { page, score: 100 };
      if (url.includes('section.blog.naver.com')) return { page, score: 80 };
      if (url.includes('naver.com')) return { page, score: 50 };
      return { page, score: 10 };
    })
    .sort((a, b) => b.score - a.score);
  return ranked[0]?.score ? ranked[0].page : pages[0];
}

/**
 * 글쓰기 가능 상태 — 로그인 링크가 없고 글쓰기 진입점이 보이면 OK.
 * BlogHome(section.blog)도 렌더만 끝나면 글쓰기 버튼이 있으므로 정상 상태로 취급한다.
 */
export async function isBlogWriteReady(page: Page): Promise<boolean> {
  const url = page.url();
  if (url.includes('nidlogin')) return false;

  const loginLink = page.locator('a[href*="nidlogin.login"], a.link_login').first();
  if (await loginLink.isVisible({ timeout: 1000 }).catch(() => false)) return false;

  return (await findBlogWriteEntry(page, 3000)) !== null;
}

/** CAPTCHA hold 종료 전 — 로그인 리다이렉트 완료·blog 방문으로 프로필 쿠키 저장 */
export async function persistPostingSessionBeforeHoldClose(context: BrowserContext): Promise<void> {
  const page = pickNaverCaptchaPage(context) ?? pickPostingWorkflowPage(context);
  if (!page) return;

  if (await isNaverCaptchaVisible(page)) return;

  if (page.url().includes('nidlogin.login')) {
    await page
      .waitForURL((u) => !u.href.includes('nidlogin.login'), { timeout: 20_000 })
      .catch(() => {});
  }

  await gotoBlogPortal(page).catch(() => {});
  await humanSleep(...scaleMs(800, 1800));
}

/**
 * CAPTCHA 해결 후 — 로그인 제출 완료 + 글쓰기 진입점 확인.
 * BlogHome 은 탈출하지 않고 렌더 대기 후 진입점을 찾는다 (무한 네비게이션 금지).
 */
export async function ensurePostingSessionAfterCaptcha(
  context: BrowserContext,
  accountId: string,
): Promise<boolean> {
  const page = pickNaverCaptchaPage(context) ?? pickPostingWorkflowPage(context);
  if (!page || page.isClosed()) return false;

  const url = page.url();
  if (url === 'about:blank' || url === '') return false;

  if (await isNaverCaptchaVisible(page)) return false;

  if (page.url().includes('nidlogin.login')) {
    await ensureNaverLoginCredentialsForCaptcha(page, accountId, { fast: true });
    await clickNaverLoginButton(page);
    await page
      .waitForURL((u) => !u.href.includes('nidlogin.login'), { timeout: 25_000 })
      .catch(() => {});
    if (page.url().includes('nidlogin.login')) return false;
    await humanSleep(...scaleMs(800, 1500));
  }

  const probe = pickPostingWorkflowPage(context) ?? page;
  if (await isBlogWriteReady(probe)) return true;

  const blogUrl = await loadAccountBlogUrl(accountId).catch(() => undefined);
  const entry = await ensureBlogWriteEntry(probe, blogUrl);
  return entry !== null;
}

/** VNC CAPTCHA 해결 직후 — blog.naver.com 글쓰기 가능 여부만 확인 */
export async function probeBlogSessionAfterCaptcha(context: BrowserContext): Promise<boolean> {
  const page = await context.newPage().catch(() => null);
  if (!page) return false;
  try {
    await gotoBlogPortal(page);
    await humanSleep(...scaleMs(400, 900));
    return await isBlogWriteReady(page);
  } catch {
    return false;
  } finally {
    await page.close().catch(() => {});
  }
}
