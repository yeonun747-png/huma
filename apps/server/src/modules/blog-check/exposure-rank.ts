/** 네이버 검색 결과 href → 포스트 번호 */
export function postNoFromBlogHref(href: string): string | null {
  const trimmed = href.trim();
  if (!trimmed) return null;
  const logNo = trimmed.match(/[?&]logNo=(\d+)/i);
  if (logNo?.[1]) return logNo[1];
  const path = trimmed.match(/blog\.naver\.com\/[^/?#]+\/(\d+)/i);
  if (path?.[1]) return path[1];
  const mobile = trimmed.match(/m\.blog\.naver\.com\/[^/?#]+\/(\d+)/i);
  if (mobile?.[1]) return mobile[1];
  return null;
}

export const BLOG_SEARCH_PAGE_SIZE = 10;

/** 1페이지(기본 10건) 내 포스트 순위 — 없으면 null */
export function findPostRankInHrefs(
  hrefs: string[],
  postNo: string,
  pageSize = BLOG_SEARCH_PAGE_SIZE,
): number | null {
  const limit = Math.min(hrefs.length, pageSize);
  for (let i = 0; i < limit; i++) {
    if (postNoFromBlogHref(hrefs[i]) === postNo) return i + 1;
  }
  return null;
}
