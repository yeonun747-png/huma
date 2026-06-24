import { ensureHttpsUrl } from '../../lib/blog-link.js';
import { blogIdFromBlogHref, postNoFromBlogHref } from './exposure-rank.js';

const BLOG_ID_RE = /blog\.naver\.com\/([^/?#]+)/i;
const POST_NO_RE = /(?:logNo=|\/)(\d{6,})(?:[/?#]|$)/;

/** 포스트 URL에서 blogId 추출 — PostView?blogId= · m.blog 경로 포함 */
export function extractBlogIdFromPostUrl(postUrl: string): string | null {
  return blogIdFromBlogHref(postUrl) ?? extractBlogIdFromUrl(postUrl);
}

export function postBelongsToBlog(postUrl: string, blogId: string | null | undefined): boolean {
  if (!blogId?.trim()) return true;
  const bid = extractBlogIdFromPostUrl(postUrl);
  return bid?.toLowerCase() === blogId.trim().toLowerCase();
}

/** 발행 result_url → blog.naver.com/{blogId}/{postNo} (필터·병합 일관성) */
export function canonicalBlogPostUrl(postUrl: string): string {
  const trimmed = postUrl.trim();
  if (!trimmed) return trimmed;
  const blogId = extractBlogIdFromPostUrl(trimmed);
  const postNo = postNoFromBlogHref(trimmed) ?? extractPostNoFromUrl(trimmed);
  if (blogId && postNo) return normalizeBlogPostUrl(blogId, postNo);
  return ensureHttpsUrl(trimmed);
}

export function extractBlogIdFromUrl(blogUrl: string | null | undefined, naverId?: string | null): string | null {
  if (blogUrl) {
    const m = blogUrl.match(BLOG_ID_RE);
    if (m?.[1] && !['PostView', 'PostList', 'profile'].includes(m[1])) return m[1];
  }
  const id = naverId?.trim();
  return id || null;
}

/** 블로그 지수 검색 — @huma/shared 와 동일 */
export { parseBlogCheckSearchQuery } from '@huma/shared';

export function extractPostNoFromUrl(postUrl: string): string | null {
  const trimmed = postUrl.trim();
  if (!trimmed) return null;
  const logNo = trimmed.match(/[?&]logNo=(\d+)/i);
  if (logNo?.[1]) return logNo[1];
  const path = trimmed.match(/blog\.naver\.com\/[^/?#]+\/(\d+)/i);
  if (path?.[1]) return path[1];
  const mobile = trimmed.match(/m\.blog\.naver\.com\/[^/?#]+\/(\d+)/i);
  if (mobile?.[1]) return mobile[1];
  const m = trimmed.match(POST_NO_RE);
  return m?.[1] ?? null;
}

/** posts 테이블 row — post_no 컬럼 비어 있어도 URL에서 보정 */
export function postNoFromDbRow(row: {
  post_no?: string | null;
  post_url?: string | null;
}): string | null {
  const fromCol = String(row.post_no ?? '').trim();
  if (fromCol) return fromCol;
  return extractPostNoFromUrl(String(row.post_url ?? ''));
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

export function mobilePostViewUrl(blogId: string, postNo: string): string {
  return `https://m.blog.naver.com/PostView.naver?blogId=${encodeURIComponent(blogId)}&logNo=${encodeURIComponent(postNo)}`;
}

export function mobilePostPermalink(blogId: string, postNo: string): string {
  return `https://m.blog.naver.com/${encodeURIComponent(blogId)}/${encodeURIComponent(postNo)}`;
}

/** naver.com·*.naver.com·naver.me — 외부링크에서 제외(네이버 생태계) */
export function isNaverOwnedUrl(raw: string): boolean {
  try {
    const host = new URL(ensureHttpsUrl(raw.trim())).hostname.toLowerCase();
    return (
      host === 'naver.com' ||
      host.endsWith('.naver.com') ||
      host === 'naver.me' ||
      host.endsWith('.naver.me')
    );
  } catch {
    return false;
  }
}

/** 본문·link_url 기준 외부 링크 개수 (네이버 생태계 제외) */
export function countExternalLinks(content: string | null | undefined, linkUrl?: string | null): number {
  let count = 0;
  const seen = new Set<string>();

  const add = (raw: string) => {
    const url = ensureHttpsUrl(raw);
    if (!url || seen.has(url)) return;
    if (!/^https?:\/\//i.test(url)) return;
    if (isNaverOwnedUrl(url)) return;
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

/** post_blog — link_url·본문에 있는 실제 외부 링크만 집계 (네이버 생태계 제외) */
export function resolveExtLinkCount(
  content: string | null | undefined,
  linkUrl: string | null | undefined,
): number {
  return countExternalLinks(content, linkUrl);
}

export function plainTextLength(content: string | null | undefined): number {
  if (!content?.trim()) return 0;
  // 발행 markdown — 이미지/링크 문법 제거 후 줄바꿈 유지 (본문 글자수에 가깝게)
  return content
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^>\s?/gm, '')
    .replace(/[#*_`~]/g, '')
    .replace(/\u00a0/g, ' ')
    .trim()
    .length;
}
