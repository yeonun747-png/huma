import type { Page } from 'playwright';
import { buildNexearchSearchUrl } from '@huma/shared';
import { humanSleep } from '../modules/human-engine/typing.js';

/** 레거시 + 2026 FDS 통합검색 */
const INTEGRATED_SELECTORS = [
  'a.api_txt_lines.total_tit',
  '.view_wrap a.api_txt_lines',
  '.total_wrap a.api_txt_lines',
  '.news_wrap a[href^="http"]',
  'a.link_tit[href^="http"]',
  '.fds-comps-lib-body a[href^="http"]',
  '[class*="fds-"] a[href^="http"]',
  '#main_pack a[href^="http"]',
  'a[href*="n.news.naver.com"]',
  'a[href*="news.naver.com/article"]',
  'a[href*="in.naver.com/"]',
  'a[href*="cafe.naver.com"]',
  'a[href*="clip.naver.com"]',
];

const BLOG_SELECTORS = [
  'a.api_txt_lines.total_tit',
  '.total_tit a[href*="blog.naver.com"]',
  '.view_wrap a[href*="blog.naver.com"]',
  '.total_wrap a[href*="blog.naver.com"]',
  '#main_pack a[href*="blog.naver.com"]',
  'a[href*="blog.naver.com/"]',
  'a[href*="m.blog.naver.com"]',
];

export type NaverSearchCollectDiagnostics = {
  mode: 'integrated' | 'blog';
  rawHrefCount: number;
  passedFilterCount: number;
  rejectedByFilterCount: number;
  selectorElementCount: number;
  hasMainPack: boolean;
};

export type NaverSearchCollectResult = {
  urls: string[];
  diagnostics: NaverSearchCollectDiagnostics;
};

function emptyDiagnostics(mode: 'integrated' | 'blog'): NaverSearchCollectDiagnostics {
  return {
    mode,
    rawHrefCount: 0,
    passedFilterCount: 0,
    rejectedByFilterCount: 0,
    selectorElementCount: 0,
    hasMainPack: false,
  };
}

function normalizeHref(href: string | null | undefined): string | null {
  if (!href?.trim()) return null;
  const h = href.trim();
  if (h.startsWith('http://') || h.startsWith('https://')) return h;
  if (h.startsWith('//')) return `https:${h}`;
  if (h.startsWith('/')) return `https://search.naver.com${h}`;
  return null;
}

function isBlockedWarmupNav(url: string): boolean {
  return (
    url.includes('search.naver.com') ||
    url.includes('nid.naver.com') ||
    url.includes('help.naver.com') ||
    url.includes('policy.naver.com') ||
    url.includes('javascript:') ||
    url.includes('ader.naver.com')
  );
}

/** 로그인 전 워밍업 — 쇼핑 GNB·탭·검색결과 링크 모두 제외 */
export function isShoppingWarmupTarget(href: string, text = ''): boolean {
  const h = href.toLowerCase();
  const t = text.trim();
  if (/shopping\.naver\.com|search\.shopping\.naver\.com/i.test(h)) return true;
  if (/ssc=tab\.shopping|where=shopping|tab_shopping|\/shopping\b/i.test(h)) return true;
  if (/brand\.naver\.com\/n\/shopping/i.test(h)) return true;
  if (t.includes('쇼핑')) return true;
  return false;
}

/** namu·tistory 등 SPA — LTE SOCKS에서 30s+ 로드, 워밍업 타임아웃 유발 */
function isHeavyWarmupHost(url: string): boolean {
  return (
    url.includes('namu.wiki') ||
    url.includes('tistory.com') ||
    url.includes('fandom.com') ||
    url.includes('wikipedia.org')
  );
}

export function isIntegratedWarmupLink(url: string): boolean {
  if (isBlockedWarmupNav(url)) return false;
  if (isShoppingWarmupTarget(url)) return false;
  if (url.includes('blog.naver.com')) return false;
  if (isHeavyWarmupHost(url)) return false;
  return url.startsWith('http');
}

export function isBlogWarmupLink(url: string): boolean {
  if (isBlockedWarmupNav(url)) return false;
  return url.includes('blog.naver.com');
}

function isDestroyedContextError(err: unknown): boolean {
  const msg = String((err as Error)?.message ?? err);
  return (
    msg.includes('Execution context was destroyed') ||
    msg.includes('Target page, context or browser has been closed')
  );
}

async function collectBySelectors(
  page: Page,
  selectors: string[],
  filter: (url: string) => boolean,
  max: number,
  diagnostics: NaverSearchCollectDiagnostics,
): Promise<string[]> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const urls: string[] = [];
      for (const selector of selectors) {
        const links = page.locator(selector);
        const count = await links.count();
        diagnostics.selectorElementCount += count;
        for (let i = 0; i < count && urls.length < max; i++) {
          const href = normalizeHref(await links.nth(i).getAttribute('href'));
          if (!href) continue;
          diagnostics.rawHrefCount += 1;
          if (!filter(href)) {
            diagnostics.rejectedByFilterCount += 1;
            continue;
          }
          if (urls.includes(href)) continue;
          diagnostics.passedFilterCount += 1;
          urls.push(href);
        }
        if (urls.length >= max) break;
      }
      return urls;
    } catch (err) {
      if (!isDestroyedContextError(err) || attempt >= 2) throw err;
      await page.waitForLoadState('domcontentloaded', { timeout: 20_000 }).catch(() => {});
      await humanSleep(800, 1500);
    }
  }
  return [];
}

/** 통합검색·블로그검색 결과에서 방문 URL 수집 (셀렉터 + 스크롤 재시도 + 진단) */
export async function collectNaverSearchUrlsDetailed(
  page: Page,
  mode: 'integrated' | 'blog',
  max: number,
): Promise<NaverSearchCollectResult> {
  const selectors = mode === 'blog' ? BLOG_SELECTORS : INTEGRATED_SELECTORS;
  const filter = mode === 'blog' ? isBlogWarmupLink : isIntegratedWarmupLink;
  const diagnostics = emptyDiagnostics(mode);
  try {
    diagnostics.hasMainPack = (await page.locator('#main_pack').count()) > 0;
  } catch (err) {
    if (!isDestroyedContextError(err)) throw err;
    diagnostics.hasMainPack = false;
  }

  let urls = await collectBySelectors(page, selectors, filter, max, diagnostics);
  if (urls.length >= max) {
    return { urls: urls.slice(0, max), diagnostics };
  }

  await page.mouse.wheel(0, 500);
  await humanSleep(1000, 2000);
  const more = await collectBySelectors(page, selectors, filter, max, diagnostics);
  for (const u of more) {
    if (!urls.includes(u)) urls.push(u);
    if (urls.length >= max) break;
  }

  return { urls: urls.slice(0, max), diagnostics };
}

/** @deprecated 진단 없이 URL만 필요할 때 — 상세는 collectNaverSearchUrlsDetailed 사용 */
export async function collectNaverSearchUrls(
  page: Page,
  mode: 'integrated' | 'blog',
  max: number,
): Promise<string[]> {
  const { urls } = await collectNaverSearchUrlsDetailed(page, mode, max);
  return urls;
}

export function integratedSearchUrl(keyword: string, start = 1): string {
  return buildNexearchSearchUrl(keyword, start);
}

/** @deprecated 블로그 지수 노출은 integratedSearchUrl(nexearch) 사용 */
export function blogTabAllSearchUrl(keyword: string, start = 1): string {
  const base = `https://search.naver.com/search.naver?ssc=tab.blog.all&sm=tab_jum&query=${encodeURIComponent(keyword)}`;
  return start > 1 ? `${base}&start=${start}` : base;
}

export function blogSearchUrl(keyword: string): string {
  return `https://search.naver.com/search.naver?where=blog&query=${encodeURIComponent(keyword)}&sm=tab_jum`;
}
