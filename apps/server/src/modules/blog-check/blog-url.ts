import { ensureHttpsUrl, workspaceBlogHomeUrl } from '../../lib/blog-link.js';

const BLOG_ID_RE = /blog\.naver\.com\/([^/?#]+)/i;
const POST_NO_RE = /(?:logNo=|\/)(\d{6,})(?:[/?#]|$)/;

export function extractBlogIdFromUrl(blogUrl: string | null | undefined, naverId?: string | null): string | null {
  if (blogUrl) {
    const m = blogUrl.match(BLOG_ID_RE);
    if (m?.[1] && !['PostView', 'PostList', 'profile'].includes(m[1])) return m[1];
  }
  const id = naverId?.trim();
  return id || null;
}

export function extractPostNoFromUrl(postUrl: string): string | null {
  const trimmed = postUrl.trim();
  if (!trimmed) return null;
  const logNo = trimmed.match(/[?&]logNo=(\d+)/i);
  if (logNo?.[1]) return logNo[1];
  const path = trimmed.match(/blog\.naver\.com\/[^/?#]+\/(\d+)/i);
  if (path?.[1]) return path[1];
  const m = trimmed.match(POST_NO_RE);
  return m?.[1] ?? null;
}

export function normalizePostUrlKey(postUrl: string): string {
  return ensureHttpsUrl(postUrl.trim()).replace(/\/$/, '').toLowerCase();
}

export function postRowMergeKey(postUrl: string, postNo?: string | null): string {
  const no = postNo ?? extractPostNoFromUrl(postUrl);
  if (no) return `no:${no}`;
  return normalizePostUrlKey(postUrl);
}

export function normalizeBlogPostUrl(blogId: string, postNo: string): string {
  return `https://blog.naver.com/${blogId}/${postNo}`;
}

/** 본문·link_url 기준 외부 링크 개수 (네이버 블로그 내부 제외) */
export function countExternalLinks(content: string | null | undefined, linkUrl?: string | null): number {
  let count = 0;
  const seen = new Set<string>();

  const add = (raw: string) => {
    const url = ensureHttpsUrl(raw);
    if (!url || seen.has(url)) return;
    if (!/^https?:\/\//i.test(url)) return;
    if (/blog\.naver\.com|naver\.me|naver\.com\/blog/i.test(url)) return;
    seen.add(url);
    count += 1;
  };

  if (linkUrl?.trim()) add(linkUrl);

  const mdLinks = content?.matchAll(/\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g) ?? [];
  for (const m of mdLinks) add(m[2]);

  const bare = content?.matchAll(/https?:\/\/[^\s)\]"'<>]+/g) ?? [];
  for (const m of bare) add(m[0]);

  if (/yeonun\.com/i.test(content ?? '')) add('https://yeonun.com');
  else if (/myquizoasis\.com/i.test(content ?? '')) add('https://myquizoasis.com');
  else if (/panana\.com/i.test(content ?? '')) add('https://panana.com');

  return count;
}

/** post_blog — link_url·본문·워크스페이스 기준 외부링크 수 (최소 1: HUMA 발행 OG 링크) */
export function resolveExtLinkCount(
  content: string | null | undefined,
  linkUrl: string | null | undefined,
  workspace?: string | null,
): number {
  const fromText = countExternalLinks(content, linkUrl);
  if (fromText > 0) return fromText;
  if (linkUrl?.trim()) return 1;
  if (workspace && ['yeonun', 'quizoasis', 'panana'].includes(workspace)) return 1;
  try {
    if (workspace && countExternalLinks(content, workspaceBlogHomeUrl(workspace)) > 0) return 1;
  } catch {
    /* ignore */
  }
  return 0;
}

export function plainTextLength(content: string | null | undefined): number {
  if (!content?.trim()) return 0;
  return content.replace(/[#*_`~\[\]()]/g, '').replace(/\s+/g, ' ').trim().length;
}
