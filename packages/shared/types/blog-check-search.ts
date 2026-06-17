const RESERVED_BLOG_PATHS = new Set(['PostView', 'PostList', 'profile']);
const NAVER_BLOG_PREFIX_RE = /^(?:https?:\/\/)?(?:m\.)?blog\.naver\.com\/?/i;
const BLOG_ID_IN_URL_RE = /blog\.naver\.com\/([^/?#]+)/i;
const MOBILE_BLOG_ID_RE = /m\.blog\.naver\.com\/([^/?#]+)/i;
const BARE_BLOG_ID_RE = /^[a-zA-Z0-9._-]{2,40}$/;

/** 블로그 지수 검색 — blogId만(goricc) · blog.naver.com/goricc · 전체 URL */
export function parseBlogCheckSearchQuery(raw: string): string | null {
  let q = raw.trim();
  if (!q) return null;

  if (q.startsWith('@')) q = q.slice(1).trim();

  const urlCandidate = q.startsWith('http') ? q : q.includes('blog.naver.com') ? `https://${q.replace(/^\/\//, '')}` : q;

  const fromPc = urlCandidate.match(BLOG_ID_IN_URL_RE);
  if (fromPc?.[1] && !RESERVED_BLOG_PATHS.has(fromPc[1])) return fromPc[1];

  const fromMobile = urlCandidate.match(MOBILE_BLOG_ID_RE);
  if (fromMobile?.[1] && !RESERVED_BLOG_PATHS.has(fromMobile[1])) return fromMobile[1];

  q = q.replace(NAVER_BLOG_PREFIX_RE, '');
  q = q.replace(/^\/+/, '');
  q = (q.split(/[?#]/)[0] ?? '').split('/')[0]?.trim() ?? '';

  if (!q || RESERVED_BLOG_PATHS.has(q)) return null;
  if (BARE_BLOG_ID_RE.test(q)) return q;
  return null;
}

export function blogCheckQueryMatchesBlogId(query: string, blogId: string): boolean {
  const parsed = parseBlogCheckSearchQuery(query);
  if (parsed) return parsed.toLowerCase() === blogId.toLowerCase();
  return query.trim().toLowerCase() === blogId.toLowerCase();
}
