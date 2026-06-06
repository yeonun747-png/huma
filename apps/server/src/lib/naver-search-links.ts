import type { Page } from 'playwright';
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
    url.includes('javascript:')
  );
}

export function isIntegratedWarmupLink(url: string): boolean {
  if (isBlockedWarmupNav(url)) return false;
  if (url.includes('blog.naver.com')) return false;
  return url.startsWith('http');
}

export function isBlogWarmupLink(url: string): boolean {
  if (isBlockedWarmupNav(url)) return false;
  return url.includes('blog.naver.com');
}

async function collectBySelectors(
  page: Page,
  selectors: string[],
  filter: (url: string) => boolean,
  max: number,
): Promise<string[]> {
  const urls: string[] = [];
  for (const selector of selectors) {
    const links = page.locator(selector);
    const count = await links.count();
    for (let i = 0; i < count && urls.length < max; i++) {
      const href = normalizeHref(await links.nth(i).getAttribute('href'));
      if (!href || !filter(href) || urls.includes(href)) continue;
      urls.push(href);
    }
    if (urls.length >= max) break;
  }
  return urls;
}

/** 통합검색·블로그검색 결과에서 방문 URL 수집 (셀렉터 + 스크롤 재시도) */
export async function collectNaverSearchUrls(
  page: Page,
  mode: 'integrated' | 'blog',
  max: number,
): Promise<string[]> {
  const selectors = mode === 'blog' ? BLOG_SELECTORS : INTEGRATED_SELECTORS;
  const filter = mode === 'blog' ? isBlogWarmupLink : isIntegratedWarmupLink;

  let urls = await collectBySelectors(page, selectors, filter, max);
  if (urls.length >= max) return urls.slice(0, max);

  await page.mouse.wheel(0, 500);
  await humanSleep(1000, 2000);
  const more = await collectBySelectors(page, selectors, filter, max);
  for (const u of more) {
    if (!urls.includes(u)) urls.push(u);
    if (urls.length >= max) break;
  }

  return urls.slice(0, max);
}

export function integratedSearchUrl(keyword: string): string {
  return `https://search.naver.com/search.naver?query=${encodeURIComponent(keyword)}`;
}

export function blogSearchUrl(keyword: string): string {
  return `https://search.naver.com/search.naver?where=blog&query=${encodeURIComponent(keyword)}&sm=tab_jum`;
}
