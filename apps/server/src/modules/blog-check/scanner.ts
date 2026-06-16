import type { Page } from 'playwright';
import { createBrowser } from '../playwright/browser.js';
import { sleep } from '../../lib/utils.js';
import { extractBlogIdFromUrl, extractPostNoFromUrl } from './blog-url.js';

const SEARCH_GAP_MS = 900;

/** 비로그인 전용 Playwright 컨텍스트 (기존 로그인 세션과 분리) */
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

export async function scanPostsIndexed(
  page: Page,
  blogId: string,
  posts: { postNo: string }[],
  onProgress?: (done: number, total: number) => void,
): Promise<Map<string, boolean>> {
  const results = new Map<string, boolean>();
  for (let i = 0; i < posts.length; i++) {
    const { postNo } = posts[i];
    results.set(postNo, await checkPostIndexed(page, blogId, postNo));
    onProgress?.(i + 1, posts.length);
    if (i < posts.length - 1) await sleep(SEARCH_GAP_MS);
  }
  return results;
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
