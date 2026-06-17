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

export const BLOG_SEARCH_PAGE_SIZE = 10;

/** blai 등 — 제목 검색 3페이지(최대 30건)까지 약함(11~30위) 판정 */
export const BLOG_SEARCH_RANK_PAGES = 3;

export const BLOG_SEARCH_MAX_RANK = BLOG_SEARCH_PAGE_SIZE * BLOG_SEARCH_RANK_PAGES;

/** 제목 검색 순위(1~maxRank) — 없으면 null */
export function findPostRankInHrefs(
  hrefs: string[],
  postNo: string,
  maxRank = BLOG_SEARCH_MAX_RANK,
): number | null {
  const limit = Math.min(hrefs.length, maxRank);
  for (let i = 0; i < limit; i++) {
    if (postNoFromBlogHref(hrefs[i]) === postNo) return i + 1;
  }
  return null;
}
