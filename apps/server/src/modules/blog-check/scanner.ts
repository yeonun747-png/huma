import type { Page } from 'playwright';
import { createBrowser } from '../playwright/browser.js';
import { isNaverCaptchaVisible } from '../../lib/naver-captcha-vision.js';
import { randomBetween, sleep } from '../../lib/utils.js';
import { extractBlogIdFromUrl, extractPostNoFromUrl } from './blog-url.js';

export class BlogCheckCaptchaError extends Error {
  constructor(public readonly blogId: string) {
    super('BLOG_CHECK_CAPTCHA');
    this.name = 'BlogCheckCaptchaError';
  }
}

/** 포스트 1건 스캔 간격 — 3~7초 랜덤 (봇 감지 완화) */
export function randomScanDelayMs(): number {
  return randomBetween(3000, 7000);
}

/** 비로그인 전용 Playwright 컨텍스트 (Stealth 플러그인은 createBrowser 경유) */
export async function withBlogCheckBrowser<T>(
  run: (page: Page) => Promise<T>,
): Promise<T> {
  const { browser, context } = await createBrowser();
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(25_000);
    return await run(page);
  } finally {
    await browser.close();
  }
}

export async function detectBlogCheckCaptcha(page: Page): Promise<boolean> {
  if (await isNaverCaptchaVisible(page)) return true;
  const text = await page.locator('body').innerText().catch(() => '');
  const url = page.url();
  return (
    /captcha|자동입력\s*방지|보안\s*문자|비정상적인\s*접근|robot|reCAPTCHA/i.test(text) ||
    /captcha|cptch/i.test(url)
  );
}

/** site:blog.naver.com/계정ID/포스트번호 — 검색 결과에 URL 있으면 수집됨 */
export async function checkPostIndexed(
  page: Page,
  blogId: string,
  postNo: string,
): Promise<boolean> {
  const query = `site:blog.naver.com/${blogId}/${postNo}`;
  const url = `https://search.naver.com/search.naver?where=nexearch&sm=top_hty&query=${encodeURIComponent(query)}`;
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await sleep(1200);

  if (await detectBlogCheckCaptcha(page)) {
    throw new BlogCheckCaptchaError(blogId);
  }

  const bodyText = await page.locator('body').innerText().catch(() => '');
  if (/검색결과가 없습니다|에 대한 검색 결과가 없습니다|결과를 찾을 수 없/i.test(bodyText)) {
    return false;
  }

  const hrefs = await page.locator('a[href*="blog.naver.com"]').evaluateAll((els) =>
    els.map((el) => el.getAttribute('href') ?? ''),
  );
  if (hrefs.some((href) => href.includes(`/${postNo}`) || href.includes(`logNo=${postNo}`))) {
    return true;
  }

  if (/blog\.naver\.com/i.test(bodyText) && bodyText.includes(postNo)) {
    return true;
  }

  return false;
}

export function resolveBlogId(
  blogUrl: string | null | undefined,
  naverId: string | null | undefined,
): string | null {
  return extractBlogIdFromUrl(blogUrl, naverId);
}

export function resolvePostNo(postUrl: string): string | null {
  return extractPostNoFromUrl(postUrl);
}
