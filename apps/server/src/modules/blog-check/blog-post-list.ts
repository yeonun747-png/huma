import type { Page } from 'playwright';
import { BLOG_CHECK_POST_LIMIT, BLOG_CHECK_PAGE_SETTLE_MS } from './constants.js';
import { sleep } from '../../lib/utils.js';
import { redisConnection } from '../queue/producer.js';
import { normalizeBlogPostUrl } from './blog-url.js';
import { withBlogCheckBrowser } from './scanner.js';

export interface ScrapedBlogPost {
  postNo: string;
  postUrl: string;
  title: string;
  publishedAt: string | null;
}

const CACHE_TTL_SEC = 3600;
const POST_LIST_LIMIT = BLOG_CHECK_POST_LIMIT;

const cacheKey = (accountId: string, blogId: string) =>
  `blog_check:postlist:${accountId}:${blogId.toLowerCase()}`;

export async function getCachedBlogPostList(
  accountId: string,
  blogId: string,
): Promise<ScrapedBlogPost[] | null> {
  try {
    const raw = await redisConnection.get(cacheKey(accountId, blogId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ScrapedBlogPost[];
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : null;
  } catch {
    return null;
  }
}

export async function setCachedBlogPostList(
  accountId: string,
  blogId: string,
  posts: ScrapedBlogPost[],
): Promise<void> {
  try {
    await redisConnection.set(cacheKey(accountId, blogId), JSON.stringify(posts), 'EX', CACHE_TTL_SEC);
  } catch (err) {
    console.error('[blog-check] postlist cache set failed:', err);
  }
}

/** 계정 blog_url 변경 시 — accountId 단위 구 캐시 키 포함 전체 삭제 */
export async function clearBlogPostListCacheForAccount(accountId: string): Promise<void> {
  try {
    const pattern = `blog_check:postlist:${accountId}*`;
    const keys = await redisConnection.keys(pattern);
    if (keys.length) await redisConnection.del(...keys);
  } catch (err) {
    console.error('[blog-check] postlist cache clear failed:', err);
  }
}

interface ApiPostItem {
  logNo?: number | string;
  title?: string;
  titleWithInspectMessage?: string;
  addDate?: number | string;
}

function parseNaverListDate(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  const full = t.match(/(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})/);
  if (full) {
    const d = new Date(Number(full[1]), Number(full[2]) - 1, Number(full[3]));
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const short = t.match(/(\d{2})\.(\d{2})/);
  if (short) {
    const year = new Date().getFullYear();
    const d = new Date(year, Number(short[1]) - 1, Number(short[2]));
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}

async function scrapeBlogPostListFromDom(page: Page, blogId: string, limit: number): Promise<ScrapedBlogPost[]> {
  const listUrl = `https://m.blog.naver.com/PostList.naver?blogId=${blogId}&categoryNo=0&listStyle=ons`;
  if (!page.url().includes('PostList')) {
    await page.goto(listUrl, { waitUntil: 'domcontentloaded' });
    await sleep(BLOG_CHECK_PAGE_SETTLE_MS);
  }

  const items = await page.evaluate(
    ({ blogId, limit }) => {
      const results: { postNo: string; title: string; dateText: string }[] = [];
      const seen = new Set<string>();
      const anchors = document.querySelectorAll(
        `a[href*="logNo="], a[href*="PostView"], a[href*="/${blogId}/"]`,
      );
      for (const a of anchors) {
        const href = a.getAttribute('href') ?? '';
        const logM = href.match(/logNo=(\d+)/);
        const pathM = href.match(new RegExp(`/${blogId}/(\\d+)`));
        const postNo = logM?.[1] ?? pathM?.[1];
        if (!postNo || seen.has(postNo)) continue;
        seen.add(postNo);
        let title = (a.textContent ?? '').replace(/\s+/g, ' ').trim();
        if (title.length < 4) {
          const box = a.closest('li, article, div[class*="list"]');
          const t = box?.querySelector('strong, .title, .ell')?.textContent?.trim();
          if (t && t.length >= 4) title = t;
        }
        if (title.length < 3) continue;
        const row = a.closest('li, article, div');
        const dateText =
          (row as HTMLElement | null)?.innerText?.match(/\d{4}\.\s*\d{1,2}\.\s*\d{1,2}|\d{2}\.\d{2}/)?.[0] ?? '';
        results.push({ postNo, title: title.slice(0, 300), dateText });
        if (results.length >= limit) break;
      }
      return results;
    },
    { blogId, limit },
  );

  return items.map((i) => ({
    postNo: i.postNo,
    postUrl: normalizeBlogPostUrl(blogId, i.postNo),
    title: i.title,
    publishedAt: parseNaverListDate(i.dateText),
  }));
}

/** m.blog API(1순위) + DOM(2순위) — 블로그에 실제 발행된 최근 글 목록 */
export async function scrapeBlogPostListFromMobileApi(
  page: Page,
  blogId: string,
  limit = POST_LIST_LIMIT,
): Promise<ScrapedBlogPost[]> {
  await page.goto(`https://m.blog.naver.com/${blogId}`, { waitUntil: 'domcontentloaded' });
  await sleep(BLOG_CHECK_PAGE_SETTLE_MS);

  const apiResult = await page.evaluate(
    async ({ blogId, limit }) => {
      try {
        const res = await fetch(
          `https://m.blog.naver.com/api/blogs/${blogId}/post-list?categoryNo=0&itemCount=${limit}&page=1`,
          { credentials: 'include', headers: { Accept: 'application/json' } },
        );
        if (!res.ok) return null;
        return (await res.json()) as {
          isSuccess?: boolean;
          result?: { items?: ApiPostItem[] };
        };
      } catch {
        return null;
      }
    },
    { blogId, limit },
  );

  if (apiResult?.isSuccess && apiResult.result?.items?.length) {
    const fromApi = apiResult.result.items
      .map((item) => {
        const postNo = String(item.logNo ?? '').trim();
        if (!postNo) return null;
        const title = (item.titleWithInspectMessage ?? item.title ?? '').trim() || '—';
        let publishedAt: string | null = null;
        if (item.addDate != null) {
          const ms = typeof item.addDate === 'number' ? item.addDate : Number(item.addDate);
          if (Number.isFinite(ms) && ms > 0) publishedAt = new Date(ms).toISOString();
        }
        return {
          postNo,
          postUrl: normalizeBlogPostUrl(blogId, postNo),
          title,
          publishedAt,
        };
      })
      .filter((x): x is ScrapedBlogPost => x != null);

    if (fromApi.length) return fromApi;
  }

  return scrapeBlogPostListFromDom(page, blogId, limit);
}

export async function refreshBlogPostListCache(
  accountId: string,
  blogId: string,
  page?: Page,
): Promise<ScrapedBlogPost[]> {
  const run = async (p: Page) => scrapeBlogPostListFromMobileApi(p, blogId, POST_LIST_LIMIT);
  const posts = page ? await run(page) : await withBlogCheckBrowser(run);
  if (posts.length) await setCachedBlogPostList(accountId, blogId, posts);
  return posts;
}

/** Redis 캐시 → 없으면 m.blog 스크랩 (스캔 중이면 page 재사용) */
export async function loadBlogPostList(
  accountId: string,
  blogId: string,
  page?: Page,
): Promise<ScrapedBlogPost[]> {
  const cached = await getCachedBlogPostList(accountId, blogId);
  if (cached?.length) return cached;
  return refreshBlogPostListCache(accountId, blogId, page);
}
