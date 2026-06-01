import type { Page } from 'playwright';
import { humanSleep } from '../../human-engine/typing.js';

/** 네이버 메인/추천 블로그 등 — 페이지 링크 스크래핑 시 오선택 방지 */
const GENERIC_BLOG_IDS = new Set([
  'market',
  'section',
  'official',
  'notice',
  'blogpeople',
  'blogstory',
  'blogmodule',
]);

/** blog.naver.com URL → https://blog.naver.com/{blogId} */
export function normalizeNaverBlogUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (!u.hostname.includes('blog.naver.com')) return null;

    const blogIdParam = u.searchParams.get('blogId');
    if (blogIdParam) return `https://blog.naver.com/${blogIdParam}`;

    const segment = u.pathname.replace(/^\//, '').split('/')[0];
    const skip = new Set(['', 'PostList.naver', 'MyBlog.naver', 'write', 'PostView.naver', 'BlogHome.naver']);
    if (segment && !segment.includes('.') && !skip.has(segment)) {
      return `https://blog.naver.com/${segment}`;
    }
  } catch {
    return null;
  }
  return null;
}

export function extractBlogIdFromUrl(url: string): string | null {
  const normalized = normalizeNaverBlogUrl(url);
  if (!normalized) return null;
  return normalized.replace('https://blog.naver.com/', '');
}

function isGenericBlogId(blogId: string): boolean {
  return GENERIC_BLOG_IDS.has(blogId.toLowerCase());
}

/** MyBlog 리다이렉트 등 — 로그인 계정 소유 블로그 URL */
function isTrustedOwnBlogUrl(url: string): boolean {
  const blogId = extractBlogIdFromUrl(url);
  if (!blogId || isGenericBlogId(blogId)) return false;
  return true;
}

async function extractEmbeddedBlogId(page: Page): Promise<string | null> {
  return page
    .evaluate(() => {
      const w = window as unknown as Record<string, unknown>;
      for (const key of ['gBlogId', 'blogId', 'blogNo']) {
        const val = w[key];
        if (typeof val === 'string' && val.length > 0) return val;
        if (typeof val === 'number') return String(val);
      }
      const og = document.querySelector('meta[property="og:url"]')?.getAttribute('content');
      if (og) {
        const m = og.match(/blog\.naver\.com\/([^/?#]+)/);
        if (m?.[1]) return m[1];
      }
      const blogInput = document.querySelector('input[name="blogId"]') as HTMLInputElement | null;
      if (blogInput?.value) return blogInput.value;
      const dataEl = document.querySelector('[data-blog-id]');
      const dataId = dataEl?.getAttribute('data-blog-id');
      if (dataId) return dataId;
      return null;
    })
    .catch(() => null);
}

async function verifyBlogExists(page: Page, blogUrl: string): Promise<boolean> {
  const blogId = extractBlogIdFromUrl(blogUrl);
  if (!blogId || isGenericBlogId(blogId)) return false;

  await page.goto(blogUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await humanSleep(1000, 2000);

  if (page.url().includes('nid.naver.com')) return false;

  const bodyText = await page.locator('body').innerText().catch(() => '');
  if (/존재하지\s*않|삭제된\s*블로그|페이지를\s*찾을\s*수\s*없/i.test(bodyText)) {
    return false;
  }

  const resolved = normalizeNaverBlogUrl(page.url());
  return resolved === blogUrl || resolved === `https://blog.naver.com/${blogId}`;
}

/** MyBlog.naver → 본인 블로그로 리다이렉트되는 URL만 신뢰 */
async function resolveFromMyBlogRedirect(page: Page): Promise<string | null> {
  await page.goto('https://blog.naver.com/MyBlog.naver', {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  });
  await page
    .waitForURL(
      (url) => {
        const id = extractBlogIdFromUrl(url.href);
        return Boolean(id && !url.href.includes('MyBlog.naver'));
      },
      { timeout: 20_000 },
    )
    .catch(() => {});
  await humanSleep(1500, 2500);

  const fromRedirect = normalizeNaverBlogUrl(page.url());
  if (fromRedirect && isTrustedOwnBlogUrl(fromRedirect)) {
    return fromRedirect;
  }

  const embedded = await extractEmbeddedBlogId(page);
  if (embedded && !isGenericBlogId(embedded)) {
    return `https://blog.naver.com/${embedded}`;
  }

  return null;
}

/** 로그인된 세션에서 본인 블로그 URL 추출 (타 페이지 링크 스크래핑 금지) */
export async function resolveNaverBlogUrl(page: Page, naverId: string): Promise<string> {
  const fromMyBlog = await resolveFromMyBlogRedirect(page);
  if (fromMyBlog) return fromMyBlog;

  const naverIdUrl = `https://blog.naver.com/${naverId}`;
  if (await verifyBlogExists(page, naverIdUrl)) {
    return naverIdUrl;
  }

  throw new Error('BLOG_URL_NOT_FOUND');
}
