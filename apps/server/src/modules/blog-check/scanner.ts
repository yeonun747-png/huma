import type { Page } from 'playwright';
import { createBrowser } from '../playwright/browser.js';
import { isNaverCaptchaVisible } from '../../lib/naver-captcha-vision.js';
import { blogTabAllSearchUrl } from '../../lib/naver-search-links.js';
import { randomBetween, sleep } from '../../lib/utils.js';
import {
  BLOG_CHECK_FRAME_TIMEOUT_MS,
  BLOG_CHECK_PAGE_SETTLE_MS,
  BLOG_CHECK_SCAN_DELAY_MAX_MS,
  BLOG_CHECK_SCAN_DELAY_MIN_MS,
  BLOG_CHECK_SEARCH_SETTLE_MS,
  BLOG_CHECK_SEARCH_WAIT_MS,
} from './constants.js';
import { rankToExposureStatus, type PostRankResult } from './exposure-status.js';
import {
  findPostRankInHrefs,
  postNoFromBlogHref,
  hrefMatchesBlogPost,
  BLOG_SEARCH_PAGE_SIZE,
  BLOG_SEARCH_RANK_PAGES,
} from './exposure-rank.js';
import { extractBlogIdFromUrl, extractPostNoFromUrl } from './blog-url.js';

export class BlogCheckCaptchaError extends Error {
  constructor(public readonly blogId: string) {
    super('BLOG_CHECK_CAPTCHA');
    this.name = 'BlogCheckCaptchaError';
  }
}

/** 포스트 1건 스캔 간격 — 0.2~0.6초 랜덤 */
export function randomScanDelayMs(): number {
  return randomBetween(BLOG_CHECK_SCAN_DELAY_MIN_MS, BLOG_CHECK_SCAN_DELAY_MAX_MS);
}

export async function setupBlogCheckPage(page: Page): Promise<void> {
  page.setDefaultTimeout(12_000);
  page.setDefaultNavigationTimeout(12_000);
  await page.route('**/*', (route) => {
    const type = route.request().resourceType();
    if (type === 'image' || type === 'media' || type === 'font') {
      void route.abort();
      return;
    }
    void route.continue();
  });
}

/** m.blog PostView·본문 크롤용 모바일 UA (데스크톱 UA는 m.blog 본문 미렌더) */
const BLOG_CHECK_MOBILE_UA =
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

/** 비로그인 전용 Playwright 컨텍스트 (Stealth 플러그인은 createBrowser 경유) */
export async function withBlogCheckBrowser<T>(
  run: (page: Page) => Promise<T>,
): Promise<T> {
  const { browser, context: defaultContext } = await createBrowser();
  await defaultContext.close();

  const context = await browser.newContext({
    viewport: { width: 412, height: 915 },
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    userAgent: BLOG_CHECK_MOBILE_UA,
    isMobile: true,
    hasTouch: true,
  });

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
  await sleep(BLOG_CHECK_SEARCH_SETTLE_MS);

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
  if (hrefs.some((href) => hrefMatchesBlogPost(href, blogId, postNo))) {
    return true;
  }

  const blogPath = `blog.naver.com/${blogId}/${postNo}`;
  return bodyText.includes(blogPath) || (bodyText.includes(`blogId=${blogId}`) && bodyText.includes(`logNo=${postNo}`));
}

/**
 * ssc=tab.blog.all 관련도순 — 결과 블록당 포스트 1건, DOM 순서 유지 (페이지당 최대 10건)
 */
async function collectBlogSearchResultHrefs(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const hrefs: string[] = [];
    const seenPost = new Set<string>();

    const decodeHref = (raw: string | null | undefined): string => {
      const trimmed = (raw ?? '').trim();
      if (!trimmed) return trimmed;
      try {
        const uMatch = trimmed.match(/[?&]u=([^&]+)/i);
        if (uMatch?.[1]) return decodeURIComponent(uMatch[1]);
      } catch {
        /* ignore */
      }
      return trimmed;
    };

    const postNoFrom = (raw: string | null | undefined): string | null => {
      const href = decodeHref(raw);
      if (!href) return null;
      const logNo = href.match(/[?&]logNo=(\d+)/i);
      if (logNo?.[1]) return logNo[1];
      const path = href.match(/blog\.naver\.com\/[^/?#]+\/(\d+)/i);
      if (path?.[1]) return path[1];
      const mobile = href.match(/m\.blog\.naver\.com\/[^/?#]+\/(\d+)/i);
      if (mobile?.[1]) return mobile[1];
      return null;
    };

    const pushPost = (raw: string | null | undefined) => {
      const href = decodeHref(raw);
      if (!href.includes('blog.naver.com') && !href.includes('m.blog.naver.com')) return;
      const postNo = postNoFrom(href);
      if (!postNo) return;
      if (/PostList|buddylist|commentlist|profile|prologue|mapview/i.test(href)) return;
      if (seenPost.has(postNo)) return;
      seenPost.add(postNo);
      hrefs.push(href);
    };

    const blockSelectors = [
      '#main_pack .view_wrap',
      '#main_pack .total_wrap',
      '#main_pack .api_subject_bx',
      '#main_pack .detail_box',
      '#main_pack ul.lst_total > li',
      '#main_pack ul.lst_view > li',
      '#main_pack section[class*="sc_new"] > div',
    ];

    for (const sel of blockSelectors) {
      for (const block of document.querySelectorAll(sel)) {
        const titleLink =
          block.querySelector('a.api_txt_lines.total_tit') ??
          block.querySelector('a.title_link[href*="blog.naver.com"]') ??
          block.querySelector('.title_area a[href*="blog.naver.com"]') ??
          block.querySelector('a[href*="blog.naver.com/"]');

        if (titleLink) {
          pushPost(titleLink.getAttribute('href'));
          continue;
        }

        for (const a of block.querySelectorAll('a[href*="blog.naver.com"]')) {
          const h = a.getAttribute('href') ?? '';
          if (postNoFrom(h)) {
            pushPost(h);
            break;
          }
        }
      }
    }

    if (hrefs.length === 0) {
      document
        .querySelectorAll('#main_pack a.api_txt_lines.total_tit, #main_pack a.total_tit[href*="blog.naver.com"]')
        .forEach((el) => pushPost(el.getAttribute('href')));
    }

    if (hrefs.length === 0) {
      document.querySelectorAll('#main_pack a[href*="blog.naver.com"]').forEach((el) => {
        pushPost(el.getAttribute('href'));
      });
    }

    return hrefs.slice(0, 10);
  });
}

/** 제목 검색 1~3페이지 — 해당 포스트 순위 확정 시 조기 종료 */
async function collectTitleSearchHrefs(
  page: Page,
  query: string,
  blogId: string,
  postNo: string,
): Promise<string[]> {
  const merged: string[] = [];
  const seenPost = new Set<string>();

  for (let pageIdx = 0; pageIdx < BLOG_SEARCH_RANK_PAGES; pageIdx++) {
    const start = pageIdx * BLOG_SEARCH_PAGE_SIZE + 1;
    await page.goto(blogTabAllSearchUrl(query, start), { waitUntil: 'domcontentloaded' });
    await page
      .locator('#main_pack, .view_wrap, .total_wrap, .api_subject_bx')
      .first()
      .waitFor({ state: 'attached', timeout: BLOG_CHECK_SEARCH_WAIT_MS })
      .catch(() => {});
    await sleep(BLOG_CHECK_SEARCH_SETTLE_MS);

    if (await detectBlogCheckCaptcha(page)) {
      throw new BlogCheckCaptchaError('');
    }

    const pageHrefs = await collectBlogSearchResultHrefs(page);
    if (pageHrefs.length === 0) break;

    for (const href of pageHrefs) {
      const hrefPostNo = postNoFromBlogHref(href);
      if (!hrefPostNo || seenPost.has(hrefPostNo)) continue;
      seenPost.add(hrefPostNo);
      merged.push(href);
    }

    if (findPostRankInHrefs(merged, blogId, postNo) != null) {
      return merged;
    }

    if (pageHrefs.length < BLOG_SEARCH_PAGE_SIZE) break;
  }

  return merged;
}

/**
 * 제목 · ssc=tab.blog.all 관련도순 3페이지(30건) 순위(포스트번호) → 미등장 시 site: 폴백
 * method: 'blog-tab-all-title-search' + 'site-url-fallback'
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
    return { status: indexed ? 'weak' : 'miss', rank: null };
  }

  let hrefs: string[];
  try {
    hrefs = await collectTitleSearchHrefs(page, query, blogId, postNo);
  } catch (err) {
    if (err instanceof BlogCheckCaptchaError) {
      throw new BlogCheckCaptchaError(blogId);
    }
    throw err;
  }

  const rank = findPostRankInHrefs(hrefs, blogId, postNo);

  if (rank != null) {
    return { status: rankToExposureStatus(rank), rank };
  }

  const indexed = await checkPostIndexedBySite(page, blogId, postNo);
  return { status: indexed ? 'weak' : 'miss', rank: null };
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
