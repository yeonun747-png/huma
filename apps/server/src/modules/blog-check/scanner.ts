import type { Page } from 'playwright';
import { createBrowser } from '../playwright/browser.js';
import { isNaverCaptchaVisible, tryAutoSolveNaverCaptcha } from '../../lib/naver-captcha-vision.js';
import { logOperation } from '../../lib/log-emitter.js';
import { PLAYWRIGHT_NAV_TIMEOUT_MS } from '../../lib/playwright-nav-timeout.js';
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
  page.setDefaultTimeout(PLAYWRIGHT_NAV_TIMEOUT_MS);
  page.setDefaultNavigationTimeout(PLAYWRIGHT_NAV_TIMEOUT_MS);
}

/** nexearch·m.blog — domcontentloaded hang 시 commit 폴백 (i7 Xvfb·LTE) */
export async function navigateBlogCheck(page: Page, url: string): Promise<void> {
  const timeout = PLAYWRIGHT_NAV_TIMEOUT_MS;
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
  } catch (err) {
    const msg = String((err as Error).message ?? err);
    if (!/timeout/i.test(msg)) throw err;
    await page.goto(url, { waitUntil: 'commit', timeout }).catch(() => {});
    await page.waitForLoadState('domcontentloaded', { timeout: 30_000 }).catch(() => {});
  }
  await page
    .locator('#main_pack, [data-fender-root="true"], .view_wrap, body')
    .first()
    .waitFor({ state: 'attached', timeout: BLOG_CHECK_SEARCH_WAIT_MS })
    .catch(() => {});
  await sleep(BLOG_CHECK_SEARCH_SETTLE_MS);
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
  context.setDefaultTimeout(PLAYWRIGHT_NAV_TIMEOUT_MS);
  context.setDefaultNavigationTimeout(PLAYWRIGHT_NAV_TIMEOUT_MS);

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

export type BlogCheckCaptchaContext = {
  accountId?: string;
  workspace?: string | null;
  label?: string;
  blogId?: string;
};

/** 포스팅 발행과 동일 Vision 캡차 모듈 — 성공 시 true, 여전히 차단이면 false */
export async function resolveBlogCheckCaptcha(
  page: Page,
  ctx: BlogCheckCaptchaContext = {},
): Promise<boolean> {
  if (!(await detectBlogCheckCaptcha(page))) return true;

  const vision = await tryAutoSolveNaverCaptcha(page, {
    accountId: ctx.accountId,
    workspace: ctx.workspace,
    jobType: 'blog_check',
    accountLabel: ctx.label,
    autoLoginSubmit: page.url().includes('nidlogin'),
  });

  if (vision === 'solved') {
    await logOperation({
      level: 'info',
      message: `[blog-check] CAPTCHA Vision 자동 해결${ctx.blogId ? ` (${ctx.blogId})` : ''}`,
      account_id: ctx.accountId,
      workspace: ctx.workspace ?? undefined,
    });
    return !(await detectBlogCheckCaptcha(page));
  }

  if (vision === 'failed') {
    await logOperation({
      level: 'warn',
      message: `[blog-check] CAPTCHA Vision 3회 실패 — 스캔 중단${ctx.blogId ? ` (${ctx.blogId})` : ''}`,
      account_id: ctx.accountId,
      workspace: ctx.workspace ?? undefined,
    });
  }

  return !(await detectBlogCheckCaptcha(page));
}

async function assertBlogCheckCaptchaClear(page: Page, ctx: BlogCheckCaptchaContext): Promise<void> {
  if (await resolveBlogCheckCaptcha(page, ctx)) return;
  throw new BlogCheckCaptchaError(ctx.blogId ?? '');
}

/**
 * site:blog.naver.com/계정ID/포스트번호 — 검색 결과에 URL 있으면 수집됨
 * method: 'site-url-fallback'
 */
export async function checkPostIndexedBySite(
  page: Page,
  blogId: string,
  postNo: string,
  captchaCtx: BlogCheckCaptchaContext = {},
): Promise<boolean> {
  const query = `site:blog.naver.com/${blogId}/${postNo}`;
  const url = integratedSearchUrl(query);
  await navigateBlogCheck(page, url);

  await assertBlogCheckCaptchaClear(page, { ...captchaCtx, blogId });

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
 * nexearch 통합검색 — 유기적 SERP만 순위 반영.
 * 2026 FDS(m.search): .fds-web-normal-doc-root + data-meta-area (AI abL_rtX·관련질문 kwX_ndT 제외)
 * 레거시 데스크톱: ul.lst_total/view · view_wrap
 */
async function collectIntegratedSearchResultHrefs(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const hrefs: string[] = [];
    const seenUrl = new Set<string>();
    const excludedMetaAreas = new Set(['abL_rtX', 'kwX_ndT']);
    /** 2026 nexearch 모바일 — 통합검색 유기 블로그 SERP 블록 */
    const organicFenderAreas = new Set(['urB_coR', 'urB_boR', 'ugB_bsR', 'ugB_b1R']);

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

    const isBlogHref = (href: string): boolean => /blog\.naver\.com/i.test(href);

    const isBlogPostHref = (href: string): boolean =>
      isBlogHref(href) &&
      (/\/(\d{6,})(?:[/?#]|$)/.test(href) || /[?&]logNo=\d+/i.test(href));

    const isBlockedHref = (href: string): boolean =>
      !href ||
      href.startsWith('javascript:') ||
      href.includes('ader.naver.com') ||
      href.includes('help.naver.com') ||
      href.includes('policy.naver.com');

    const isNonOrganicBlock = (block: Element): boolean => {
      if (
        block.closest(
          '#power_link_body, [id*="power_link"], [class*="power_link"], [class*="sp_ad"], [class*="ad_area"], [class*="ad_wrap"], [class*="sp_ai"], [class*="api_ai"], [class*="ai_area"], [class*="related_question"], [class*="sp_nquiz"], [class*="brand_search"]',
        )
      ) {
        return true;
      }
      return Boolean(
        block.querySelector('[class*="power_link"], [class*="ad_area"], [class*="sp_ad"], [class*="ad_wrap"]'),
      );
    };

    const fenderRoot = (block: Element): Element | null => block.closest('[data-fender-root="true"]');

    const isExcludedFenderBlock = (block: Element): boolean => {
      const root = block.matches('[data-fender-root="true"]') ? block : fenderRoot(block);
      if (!root) return false;
      const area = root.getAttribute('data-meta-area');
      if (area && excludedMetaAreas.has(area)) return true;
      const ssuid = root.getAttribute('data-meta-ssuid');
      if (ssuid === 'ex_csa') return true;
      return isNonOrganicBlock(root);
    };

    const pickPrimaryLink = (block: Element): string | null => {
      const blogHeatmap = block.querySelector('a[data-heatmap-target=".link"][href*="blog.naver.com"]');
      if (blogHeatmap) {
        const href = decodeHref(blogHeatmap.getAttribute('href'));
        if (href && !isBlockedHref(href)) return href;
      }
      const selectors = [
        'a.api_txt_lines.total_tit[href*="blog.naver.com"]',
        'a.title_link[href*="blog.naver.com"]',
        'a.link_tit[href*="blog.naver.com"]',
        'a[data-heatmap-target=".link"][href*="blog.naver.com"]',
        'a.api_txt_lines.total_tit',
        'a.link_tit',
        'a.title_link',
        '.title_area a[href^="http"]',
        'a[href^="http"]',
      ];
      for (const sel of selectors) {
        const el = block.querySelector(sel);
        const href = decodeHref(el?.getAttribute('href'));
        if (href && !isBlockedHref(href) && isBlogHref(href)) return href;
      }
      const heatmapAny = block.querySelector('a[data-heatmap-target=".link"]');
      if (heatmapAny) {
        const href = decodeHref(heatmapAny.getAttribute('href'));
        if (href && !isBlockedHref(href) && isBlogHref(href)) return href;
      }
      for (const sel of selectors) {
        const el = block.querySelector(sel);
        const href = decodeHref(el?.getAttribute('href'));
        if (href && !isBlockedHref(href)) return href;
      }
      return null;
    };

    const pushHref = (href: string) => {
      if (isBlogHref(href) && !isBlogPostHref(href)) return;
      const normalized = href.replace(/\/$/, '');
      if (seenUrl.has(normalized)) return;
      seenUrl.add(normalized);
      hrefs.push(href);
    };

    const pushBlock = (block: Element, opts?: { skipFenderExclude?: boolean }) => {
      if (isNonOrganicBlock(block)) return;
      if (!opts?.skipFenderExclude && isExcludedFenderBlock(block)) return;
      const href = pickPrimaryLink(block);
      if (href) pushHref(href);
    };

    const pushFenderRoot = (root: Element) => {
      if (isExcludedFenderBlock(root)) return;
      const docs = root.querySelectorAll('.fds-web-normal-doc-root');
      if (docs.length > 0) {
        const sizeBefore = hrefs.length;
        for (const doc of docs) {
          pushBlock(doc);
        }
        // doc-root만 있고 링크는 루트 heatmap에만 있는 FDS 블록 폴백
        if (hrefs.length > sizeBefore) return;
      }
      const href = pickPrimaryLink(root);
      if (href) pushHref(href);
    };

    for (const root of document.querySelectorAll('[data-fender-root="true"]')) {
      const area = root.getAttribute('data-meta-area');
      if (!area || !organicFenderAreas.has(area)) continue;
      pushFenderRoot(root);
    }

    if (hrefs.length === 0) {
      for (const root of document.querySelectorAll('[data-fender-root="true"]')) {
        pushFenderRoot(root);
      }
    }

    if (hrefs.length === 0) {
      for (const block of document.querySelectorAll('.fds-web-normal-doc-root')) {
        const area = fenderRoot(block)?.getAttribute('data-meta-area');
        if (area && excludedMetaAreas.has(area)) continue;
        if (area && !organicFenderAreas.has(area)) continue;
        pushBlock(block);
      }
    }

    if (hrefs.length === 0) {
      for (const li of document.querySelectorAll('ul.lst_total > li, ul.lst_view > li')) {
        if (li.closest('#power_link_body, [class*="power_link"], [id*="power_link"]')) continue;
        pushBlock(li);
      }
    }

    if (hrefs.length === 0) {
      for (const block of document.querySelectorAll('#main_pack .view_wrap, #main_pack .total_wrap, .view_wrap, .total_wrap')) {
        if (block.closest('ul.lst_total, ul.lst_view, #power_link_body, [class*="power_link"]')) continue;
        pushBlock(block);
      }
    }

    if (hrefs.length === 0) {
      document.querySelectorAll('a.api_txt_lines.total_tit, a.link_tit, a[data-heatmap-target=".link"]').forEach((el) => {
        const block = el.closest('.fds-web-normal-doc-root, li, .view_wrap, .total_wrap, [data-fender-root="true"]') ?? el;
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
  captchaCtx: BlogCheckCaptchaContext = {},
): Promise<string[]> {
  const merged: string[] = [];
  const seenPost = new Set<string>();

  for (let pageIdx = 0; pageIdx < BLOG_SEARCH_RANK_PAGES; pageIdx++) {
    const start = pageIdx * BLOG_SEARCH_PAGE_SIZE + 1;
    await navigateBlogCheck(page, integratedSearchUrl(query, start));

    await assertBlogCheckCaptchaClear(page, { ...captchaCtx, blogId });

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
  captchaCtx: BlogCheckCaptchaContext = {},
): Promise<PostRankResult> {
  const query = title.trim();
  if (!query) {
    const indexed = await checkPostIndexedBySite(page, blogId, postNo, captchaCtx);
    return { status: indexed ? 'weak' : 'miss', rank: null };
  }

  let hrefs: string[];
  try {
    hrefs = await collectTitleSearchHrefs(page, query, blogId, postNo, captchaCtx);
  } catch (err) {
    if (err instanceof BlogCheckCaptchaError) {
      throw new BlogCheckCaptchaError(blogId);
    }
    hrefs = [];
  }

  const rank = findPostRankInHrefs(hrefs, blogId, postNo);

  if (rank != null) {
    return { status: rankToExposureStatus(rank), rank };
  }

  const indexed = await checkPostIndexedBySite(page, blogId, postNo, captchaCtx);
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
