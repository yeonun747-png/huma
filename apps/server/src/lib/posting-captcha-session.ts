import type { BrowserContext, Page } from 'playwright';

import { supabase } from '../middleware/auth.js';
import { humanSleep } from '../modules/human-engine/typing.js';
import {
  clickNaverLoginButton,
  ensureNaverLoginCredentialsForCaptcha,
} from './naver-login-fields.js';
import { isNaverCaptchaVisible, pickNaverCaptchaPage } from './naver-captcha-vision.js';
import { escapeBlogHomeAfterLogin, gotoBlogPortal, isBlogHomeFeedUrl } from './naver-blog-portal.js';
import { vncFastSleepScale } from './vnc-session.js';

function scaleMs(min: number, max: number): [number, number] {
  const s = vncFastSleepScale();
  return [Math.round(min * s), Math.round(max * s)];
}

const sessionProbeUntil = new WeakMap<BrowserContext, number>();

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
      if (url.includes('blog.naver.com') && !url.includes('section.blog')) return { page, score: 100 };
      if (url.includes('naver.com')) return { page, score: 50 };
      return { page, score: 10 };
    })
    .sort((a, b) => b.score - a.score);
  return ranked[0]?.score ? ranked[0].page : pages[0];
}

async function isBlogLoggedOutFeed(page: Page): Promise<boolean> {
  const text = (await page.locator('body').textContent({ timeout: 2500 }).catch(() => '')) ?? '';
  if (text.trim().length < 80 && isBlogHomeFeedUrl(page.url())) return true;
  return text.includes('로그아웃 상태') || text.includes('NAVER 로그인');
}

/** CAPTCHA hold 종료 전 — 로그인 리다이렉트·blog 방문으로 프로필 쿠키 저장 */
export async function persistPostingSessionBeforeHoldClose(
  context: BrowserContext,
  accountId?: string,
): Promise<void> {
  const page = pickNaverCaptchaPage(context) ?? pickPostingWorkflowPage(context);
  if (!page) return;

  if (await isNaverCaptchaVisible(page)) return;

  const blogUrl = accountId ? await loadAccountBlogUrl(accountId).catch(() => undefined) : undefined;

  if (page.url().includes('nidlogin.login')) {
    await page
      .waitForURL((url) => !url.href.includes('nidlogin.login'), { timeout: 20_000 })
      .catch(() => {});
    await escapeBlogHomeAfterLogin(page, blogUrl);
  }

  await escapeBlogHomeAfterLogin(page, blogUrl);
  if (!(await isBlogWriteReady(page))) {
    await gotoBlogPortal(page).catch(() => {});
  }
  await humanSleep(...scaleMs(800, 1800));
}

export async function isBlogWriteReady(page: Page): Promise<boolean> {
  const url = page.url();
  if (url.includes('nidlogin')) return false;
  if (isBlogHomeFeedUrl(url)) return false;

  const loginLink = page.locator('a[href*="nidlogin.login"], a.link_login, a:has-text("로그인")').first();
  if (await loginLink.isVisible({ timeout: 1500 }).catch(() => false)) return false;

  if (await isBlogLoggedOutFeed(page)) return false;

  const writeBtn = page.locator('.btn_write, a.btn_write, [class*="btn_write"]').first();
  if ((await writeBtn.count().catch(() => 0)) === 0) return false;
  return writeBtn.isVisible({ timeout: 3000 }).catch(() => false);
}

/**
 * VNC에서 CAPTCHA를 풀었을 때 — 로그인 제출·blog.naver.com 세션 확인.
 * section.blog.naver.com/BlogHome(빈 로딩·로그아웃)은 blog.naver.com 포털로 이탈.
 */
export async function ensurePostingSessionAfterCaptcha(
  context: BrowserContext,
  accountId: string,
): Promise<boolean> {
  const now = Date.now();
  const debounceUntil = sessionProbeUntil.get(context) ?? 0;
  if (now < debounceUntil) {
    const probe = pickPostingWorkflowPage(context);
    if (probe && (await isBlogWriteReady(probe))) return true;
    return false;
  }

  const page = pickNaverCaptchaPage(context) ?? pickPostingWorkflowPage(context);
  if (!page) return false;

  const url = page.url();
  if (url === 'about:blank' || url === '') return false;

  if (await isNaverCaptchaVisible(page)) return false;

  const probeEarly = pickPostingWorkflowPage(context) ?? page;
  if (await isBlogWriteReady(probeEarly)) return true;

  sessionProbeUntil.set(context, now + 12_000);

  const blogUrl = await loadAccountBlogUrl(accountId).catch(() => undefined);

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

  await escapeBlogHomeAfterLogin(probe, blogUrl);
  if (!(await isBlogWriteReady(probe))) {
    const onBlog =
      probe.url().includes('blog.naver.com') &&
      !probe.url().includes('section.blog') &&
      !isBlogHomeFeedUrl(probe.url());
    if (!onBlog) {
      await gotoBlogPortal(probe).catch(() => {});
      await humanSleep(...scaleMs(600, 1200));
    }
  }

  if (await isBlogLoggedOutFeed(probe)) return false;
  return isBlogWriteReady(probe);
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
