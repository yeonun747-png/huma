import type { Page } from 'playwright';
import { createBrowser } from '../playwright/browser.js';
import { sleep } from '../../lib/utils.js';
import { extractBlogIdFromUrl, extractPostNoFromUrl } from './blog-url.js';

const SEARCH_GAP_MS = 900;

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

/** site:blog.naver.com/계정ID/포스트번호 — 결과 1건 이상이면 수집됨 */
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

  const resultBlocks = await page.locator('.api_subject_bx, .total_wrap, #main_pack').count();
  if (resultBlocks > 0 && /blog\.naver\.com/i.test(bodyText) && bodyText.includes(postNo)) {
    return true;
  }

  return false;
}

/** https://blog.naver.com/계정ID — 블로그 지수 숫자 파싱 */
export async function scrapeBlogIndexScore(page: Page, blogId: string): Promise<number | null> {
  const candidates = [
    `https://blog.naver.com/${blogId}`,
    `https://m.blog.naver.com/${blogId}`,
  ];

  for (const url of candidates) {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await sleep(1500);

    const html = await page.content().catch(() => '');
    const text = await page.locator('body').innerText().catch(() => '');

    const patterns = [
      /블로그\s*지수[^\d]{0,20}([\d]+(?:\.[\d]+)?)/i,
      /blogIndex["'\s:]*([\d]+(?:\.[\d]+)?)/i,
      /"indexScore"\s*:\s*([\d]+(?:\.[\d]+)?)/i,
      /지수\s*([\d]+(?:\.[\d]+)?)\s*\/\s*10/i,
    ];

    for (const re of patterns) {
      const fromText = text.match(re);
      if (fromText?.[1]) {
        const n = Number(fromText[1]);
        if (Number.isFinite(n) && n >= 0 && n <= 10) return Math.round(n * 10) / 10;
      }
      const fromHtml = html.match(re);
      if (fromHtml?.[1]) {
        const n = Number(fromHtml[1]);
        if (Number.isFinite(n) && n >= 0 && n <= 10) return Math.round(n * 10) / 10;
      }
    }
  }

  return null;
}

export async function scanPostsIndexed(
  page: Page,
  blogId: string,
  posts: { postNo: string }[],
  onProgress?: (done: number, total: number) => void,
): Promise<Map<string, boolean>> {
  const results = new Map<string, boolean>();
  const total = posts.length;
  for (let i = 0; i < posts.length; i++) {
    const { postNo } = posts[i];
    const ok = await checkPostIndexed(page, blogId, postNo);
    results.set(postNo, ok);
    onProgress?.(i + 1, total);
    if (i < posts.length - 1) await sleep(SEARCH_GAP_MS);
  }
  return results;
}

export function resolvePostNo(postUrl: string, blogId: string): string | null {
  return extractPostNoFromUrl(postUrl) ?? null;
}

export function resolveBlogId(blogUrl: string | null | undefined, naverId: string | null | undefined): string | null {
  return extractBlogIdFromUrl(blogUrl, naverId);
}
