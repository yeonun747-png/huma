import type { Page } from 'playwright';
import { createBrowser } from '../playwright/browser.js';
import { isNaverCaptchaVisible } from '../../lib/naver-captcha-vision.js';
import { randomBetween, sleep } from '../../lib/utils.js';
import { rankToExposureStatus, type PostRankResult } from './exposure-status.js';
import { extractBlogIdFromUrl, extractPostNoFromUrl } from './blog-url.js';

export class BlogCheckCaptchaError extends Error {
  constructor(public readonly blogId: string) {
    super('BLOG_CHECK_CAPTCHA');
    this.name = 'BlogCheckCaptchaError';
  }
}

/** 포스트 1건 스캔 간격 — 0.5~1.5초 랜덤 */
export function randomScanDelayMs(): number {
  return randomBetween(500, 1500);
}

export async function setupBlogCheckPage(page: Page): Promise<void> {
  page.setDefaultTimeout(18_000);
  page.setDefaultNavigationTimeout(18_000);
  await page.route('**/*', (route) => {
    const type = route.request().resourceType();
    if (type === 'image' || type === 'media' || type === 'font') {
      void route.abort();
      return;
    }
    void route.continue();
  });
}

/** 비로그인 전용 Playwright 컨텍스트 (Stealth 플러그인은 createBrowser 경유) */
export async function withBlogCheckBrowser<T>(
  run: (page: Page) => Promise<T>,
): Promise<T> {
  const { browser, context } = await createBrowser();
  try {
    const page = await context.newPage();
    await setupBlogCheckPage(page);
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

/**
 * 포스트 제목으로 네이버 블로그 탭 검색 → 1페이지(10건) 순위 파악 (스펙 §2)
 * method: 'blog-tab-title-search'
 */
export async function checkPostRankByTitle(
  page: Page,
  blogId: string,
  title: string,
): Promise<PostRankResult> {
  const query = title.trim();
  if (!query) return { status: 'miss', rank: null };

  const url = `https://search.naver.com/search.naver?ssc=tab.blog.all&query=${encodeURIComponent(query)}`;
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await sleep(900);

  if (await detectBlogCheckCaptcha(page)) {
    throw new BlogCheckCaptchaError(blogId);
  }

  const rank = await page.evaluate(({ blogId }) => {
    const seen = new Set<string>();
    const hrefs: string[] = [];
    const selectors = [
      '.view_wrap a[href*="blog.naver.com"]',
      '.total_wrap a[href*="blog.naver.com"]',
      '.api_subject_bx a[href*="blog.naver.com"]',
      'a[href*="blog.naver.com"]',
    ];

    for (const sel of selectors) {
      for (const el of document.querySelectorAll(sel)) {
        const href = el.getAttribute('href') ?? '';
        if (!href.includes('blog.naver.com')) continue;
        const key = href.split('#')[0].split('?')[0];
        if (seen.has(key)) continue;
        seen.add(key);
        hrefs.push(href);
        if (hrefs.length >= 10) break;
      }
      if (hrefs.length >= 10) break;
    }

    for (let i = 0; i < hrefs.length; i++) {
      const href = hrefs[i];
      if (
        href.includes(`blog.naver.com/${blogId}/`) ||
        href.includes(`blogId=${blogId}`) ||
        href.includes(`/${blogId}/`)
      ) {
        return i + 1;
      }
    }
    return null;
  }, { blogId });

  return { status: rankToExposureStatus(rank), rank };
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
