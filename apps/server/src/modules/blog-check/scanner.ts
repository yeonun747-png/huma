import type { Page } from 'playwright';
import { createBrowser } from '../playwright/browser.js';
import { isNaverCaptchaVisible } from '../../lib/naver-captcha-vision.js';
import { blogSearchUrl } from '../../lib/naver-search-links.js';
import { randomBetween, sleep } from '../../lib/utils.js';
import { rankToExposureStatus, type PostRankResult } from './exposure-status.js';
import { findPostRankInHrefs, BLOG_SEARCH_PAGE_SIZE } from './exposure-rank.js';
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
 * site:blog.naver.com/계정ID/포스트번호 — 검색 결과에 URL 있으면 수집됨
 * method: 'site-url-fallback'
 */
export async function checkPostIndexedBySite(
  page: Page,
  blogId: string,
  postNo: string,
): Promise<boolean> {
  const query = `site:blog.naver.com/${blogId}/${postNo}`;
  const url = `https://search.naver.com/search.naver?where=nexearch&sm=top_hty&query=${encodeURIComponent(query)}`;
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await sleep(600);

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

  return /blog\.naver\.com/i.test(bodyText) && bodyText.includes(postNo);
}

/** 블로그 탭 검색 1페이지 — 결과 블록 순서대로 제목 링크 href 수집 */
async function collectBlogSearchResultHrefs(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const hrefs: string[] = [];
    const seen = new Set<string>();

    const push = (raw: string | null | undefined) => {
      const href = (raw ?? '').trim();
      if (!href) return;
      if (!href.includes('blog.naver.com') && !href.includes('m.blog.naver.com')) return;
      const key = href.split('#')[0].split('?')[0];
      if (seen.has(key)) return;
      seen.add(key);
      hrefs.push(href);
    };

    const blocks = document.querySelectorAll(
      '#main_pack .view_wrap, #main_pack .total_wrap, #main_pack .api_subject_bx, #main_pack .detail_box',
    );

    for (const block of blocks) {
      const titleLink =
        block.querySelector('a.api_txt_lines.total_tit') ??
        block.querySelector('a.total_tit[href*="blog.naver.com"]') ??
        block.querySelector('.title_area a[href*="blog.naver.com"]') ??
        block.querySelector('a[href*="blog.naver.com/"]');
      push(titleLink?.getAttribute('href'));
    }

    if (hrefs.length === 0) {
      document
        .querySelectorAll('#main_pack a.api_txt_lines.total_tit, #main_pack a.total_tit[href*="blog.naver.com"]')
        .forEach((el) => push(el.getAttribute('href')));
    }

    if (hrefs.length === 0) {
      document.querySelectorAll('#main_pack a[href*="blog.naver.com/"]').forEach((el) => {
        const href = el.getAttribute('href') ?? '';
        if (/\d{6,}/.test(href)) push(href);
      });
    }

    return hrefs;
  });
}

/**
 * 제목 블로그탭 1페이지 순위(포스트번호 일치) → 미등장 시 site: URL 폴백
 * method: 'blog-tab-title-search' + 'site-url-fallback'
 */
export async function checkPostExposure(
  page: Page,
  blogId: string,
  postNo: string,
  title: string,
): Promise<PostRankResult> {
  const query = title.trim();
  if (!query) {
    const indexed = await checkPostIndexedBySite(page, blogId, postNo);
    return { status: indexed ? 'collect' : 'miss', rank: null };
  }

  await page.goto(blogSearchUrl(query), { waitUntil: 'domcontentloaded' });
  await page.locator('#main_pack, .view_wrap, .total_wrap').first().waitFor({ state: 'attached', timeout: 8000 }).catch(() => {});
  await sleep(900);

  if (await detectBlogCheckCaptcha(page)) {
    throw new BlogCheckCaptchaError(blogId);
  }

  const hrefs = await collectBlogSearchResultHrefs(page);
  const rank = findPostRankInHrefs(hrefs, postNo, BLOG_SEARCH_PAGE_SIZE);

  if (rank != null) {
    return { status: rankToExposureStatus(rank), rank };
  }

  const indexed = await checkPostIndexedBySite(page, blogId, postNo);
  return { status: indexed ? 'collect' : 'miss', rank: null };
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
