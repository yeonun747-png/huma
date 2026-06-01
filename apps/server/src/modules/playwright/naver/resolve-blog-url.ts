import type { Page } from 'playwright';
import { humanSleep } from '../../human-engine/typing.js';

/** blog.naver.com URL → https://blog.naver.com/{blogId} */
export function normalizeNaverBlogUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (!u.hostname.includes('blog.naver.com')) return null;

    const blogIdParam = u.searchParams.get('blogId');
    if (blogIdParam) return `https://blog.naver.com/${blogIdParam}`;

    const segment = u.pathname.replace(/^\//, '').split('/')[0];
    const skip = new Set(['', 'PostList.naver', 'MyBlog.naver', 'write', 'PostView.naver']);
    if (segment && !segment.includes('.') && !skip.has(segment)) {
      return `https://blog.naver.com/${segment}`;
    }
  } catch {
    return null;
  }
  return null;
}

async function collectBlogUrlCandidates(page: Page): Promise<string[]> {
  const found = new Set<string>();

  const push = (raw: string | null | undefined) => {
    const normalized = raw ? normalizeNaverBlogUrl(raw) : null;
    if (normalized) found.add(normalized);
  };

  push(page.url());

  const hrefs = await page.locator('a[href*="blog.naver.com"]').evaluateAll((els) =>
    els.map((el) => (el as HTMLAnchorElement).href),
  );
  for (const href of hrefs) push(href);

  const blogId = await page
    .locator('[data-blog-id], input[name="blogId"]')
    .first()
    .getAttribute('data-blog-id')
    .catch(() => null);
  if (blogId) push(`https://blog.naver.com/${blogId}`);

  return [...found];
}

/** 로그인된 세션에서 블로그 홈 접속 후 공개 블로그 URL 추출 */
export async function resolveNaverBlogUrl(page: Page, naverId: string): Promise<string> {
  const targets = [
    'https://blog.naver.com',
    'https://blog.naver.com/MyBlog.naver',
  ];

  for (const target of targets) {
    await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForLoadState('networkidle').catch(() => {});
    await humanSleep(1500, 3000);

    const candidates = await collectBlogUrlCandidates(page);
    const preferred =
      candidates.find((u) => u === `https://blog.naver.com/${naverId}`) ??
      candidates.find((u) => !u.includes('PostList')) ??
      candidates[0];
    if (preferred) return preferred;
  }

  const fallback = `https://blog.naver.com/${naverId}`;
  await page.goto(fallback, { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => {});
  if (page.url().includes('blog.naver.com')) {
    const normalized = normalizeNaverBlogUrl(page.url());
    if (normalized) return normalized;
  }

  throw new Error('BLOG_URL_NOT_FOUND');
}
