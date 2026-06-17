/** 네이버 검색 리다이렉트(crd/rd) URL → 실제 blog URL */
export function normalizeBlogSearchHref(href: string): string {
  const trimmed = href.trim();
  if (!trimmed) return trimmed;
  try {
    const uMatch = trimmed.match(/[?&]u=([^&]+)/i);
    if (uMatch?.[1]) return decodeURIComponent(uMatch[1]);
  } catch {
    /* ignore */
  }
  return trimmed;
}

const RESERVED_BLOG_IDS = new Set(['PostView', 'PostList', 'profile', 'buddyadd', 'mapview']);

/** 네이버 검색 결과 href → 블로그 ID */
export function blogIdFromBlogHref(href: string): string | null {
  const normalized = normalizeBlogSearchHref(href);
  if (!normalized) return null;
  const blogIdParam = normalized.match(/[?&]blogId=([^&]+)/i);
  if (blogIdParam?.[1]) {
    try {
      return decodeURIComponent(blogIdParam[1]);
    } catch {
      return blogIdParam[1];
    }
  }
  const path = normalized.match(/blog\.naver\.com\/([^/?#]+)/i);
  if (path?.[1] && !RESERVED_BLOG_IDS.has(path[1])) return path[1];
  const mobile = normalized.match(/m\.blog\.naver\.com\/([^/?#]+)/i);
  if (mobile?.[1] && !RESERVED_BLOG_IDS.has(mobile[1])) return mobile[1];
  return null;
}

/** 네이버 검색 결과 href → 포스트 번호 */
export function postNoFromBlogHref(href: string): string | null {
  const normalized = normalizeBlogSearchHref(href);
  if (!normalized) return null;
  const logNo = normalized.match(/[?&]logNo=(\d+)/i);
  if (logNo?.[1]) return logNo[1];
  const path = normalized.match(/blog\.naver\.com\/[^/?#]+\/(\d+)/i);
  if (path?.[1]) return path[1];
  const mobile = normalized.match(/m\.blog\.naver\.com\/[^/?#]+\/(\d+)/i);
  if (mobile?.[1]) return mobile[1];
  return null;
}

/** href가 특정 blogId/postNo 포스트를 가리키는지 */
export function hrefMatchesBlogPost(href: string, blogId: string, postNo: string): boolean {
  const bid = blogIdFromBlogHref(href);
  const pno = postNoFromBlogHref(href);
  return bid?.toLowerCase() === blogId.toLowerCase() && pno === postNo;
}

export const BLOG_SEARCH_PAGE_SIZE = 10;

/** blai 등 — 제목 검색 3페이지(최대 30건)까지 약함(11~30위) 판정 */
export const BLOG_SEARCH_RANK_PAGES = 3;

export const BLOG_SEARCH_MAX_RANK = BLOG_SEARCH_PAGE_SIZE * BLOG_SEARCH_RANK_PAGES;

/** 제목 검색 순위(1~maxRank) — 동일 blogId·postNo만 매칭 */
export function findPostRankInHrefs(
  hrefs: string[],
  blogId: string,
  postNo: string,
  maxRank = BLOG_SEARCH_MAX_RANK,
): number | null {
  const limit = Math.min(hrefs.length, maxRank);
  for (let i = 0; i < limit; i++) {
    if (hrefMatchesBlogPost(hrefs[i], blogId, postNo)) return i + 1;
  }
  return null;
}
