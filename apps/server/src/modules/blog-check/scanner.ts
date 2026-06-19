import type { Page } from 'playwright';
import { createBrowser } from '../playwright/browser.js';
import { isNaverCaptchaVisible } from '../../lib/naver-captcha-vision.js';
import { integratedSearchUrl } from '../../lib/naver-search-links.js';
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
  page.setDefaultTimeout(8_000);
  page.setDefaultNavigationTimeout(8_000);
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
  const url = integratedSearchUrl(query);
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
 * nexearch 통합검색 — 유기적 SERP(ul.lst_total/view)만 순위에 반영.
 * AI 브리핑·관련질문·파워링크 광고는 제외 (중간 광고 섹션이 순위를 밀어 올리던 원인).
 */
async function collectIntegratedSearchResultHrefs(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const hrefs: string[] = [];

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

    const isBlockedHref = (href: string): boolean =>
      !href ||
      href.startsWith('javascript:') ||
      href.includes('ader.naver.com') ||
      href.includes('help.naver.com') ||
      href.includes('policy.naver.com');

    const isNonOrganicBlock = (block: Element): boolean => {
      if (
        block.closest(
          '[class*="sp_ad"], [class*="power_link"], [class*="ad_area"], [class*="ad_wrap"], [id*="power_link"], [class*="sp_ai"], [class*="api_ai"], [class*="ai_area"], [class*="related_question"], [class*="sp_nquiz"], [class*="brand_search"]',
        )
      ) {
        return true;
      }
      return Boolean(
        block.querySelector('[class*="power_link"], [class*="ad_area"], [class*="sp_ad"], [class*="ad_wrap"]'),
      );
    };

    const pickPrimaryLink = (block: Element): string | null => {
      const selectors = [
        'a.api_txt_lines.total_tit',
        'a.title_link',
        'a.link_tit',
        '.title_area a[href^="http"]',
        'a[href^="http"]',
      ];
      for (const sel of selectors) {
        const el = block.querySelector(sel);
        const href = decodeHref(el?.getAttribute('href'));
        if (href && !isBlockedHref(href)) return href;
      }
      return null;
    };

    const pushBlock = (block: Element) => {
      if (isNonOrganicBlock(block)) return;
      const href = pickPrimaryLink(block);
      if (href) hrefs.push(href);
    };

    for (const li of document.querySelectorAll('#main_pack ul.lst_total > li, #main_pack ul.lst_view > li')) {
      pushBlock(li);
    }

    if (hrefs.length === 0) {
      for (const block of document.querySelectorAll('#main_pack .view_wrap, #main_pack .total_wrap')) {
        if (block.closest('ul.lst_total, ul.lst_view')) continue;
        pushBlock(block);
      }
    }

    if (hrefs.length === 0) {
      document.querySelectorAll('#main_pack a.api_txt_lines.total_tit, #main_pack a.link_tit').forEach((el) => {
        const block = el.closest('li, .view_wrap, .total_wrap') ?? el;
        pushBlock(block);
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
    await page.goto(integratedSearchUrl(query, start), { waitUntil: 'domcontentloaded' });
    await sleep(BLOG_CHECK_SEARCH_SETTLE_MS);

    if (await detectBlogCheckCaptcha(page)) {
      throw new BlogCheckCaptchaError('');
    }

    let pageHrefs = await collectIntegratedSearchResultHrefs(page);
    if (pageHrefs.length === 0) {
      await page
        .locator('#main_pack, .view_wrap, .total_wrap, .api_subject_bx')
        .first()
        .waitFor({ state: 'attached', timeout: BLOG_CHECK_SEARCH_WAIT_MS })
        .catch(() => {});
      await sleep(BLOG_CHECK_SEARCH_SETTLE_MS);
      pageHrefs = await collectIntegratedSearchResultHrefs(page);
    }
    if (pageHrefs.length === 0) break;

    for (const href of pageHrefs) {
      const hrefPostNo = postNoFromBlogHref(href);
      if (hrefPostNo && seenPost.has(hrefPostNo)) continue;
      if (hrefPostNo) seenPost.add(hrefPostNo);
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
 * 제목 · nexearch 통합검색 3페이지(30건) 순위 → 미등장 시 site: 폴백
 * method: 'nexearch-title-search' + 'site-url-fallback'
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
