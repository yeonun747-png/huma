const BLOG_ID_RE = /blog\.naver\.com\/([^/?#]+)/i;
const POST_NO_RE = /(?:logNo=|\/)(\d{8,})(?:[/?#]|$)/;

export function extractBlogIdFromUrl(blogUrl: string | null | undefined, naverId?: string | null): string | null {
  if (blogUrl) {
    const m = blogUrl.match(BLOG_ID_RE);
    if (m?.[1] && !['PostView', 'PostList', 'profile'].includes(m[1])) return m[1];
  }
  const id = naverId?.trim();
  return id || null;
}

export function extractPostNoFromUrl(postUrl: string): string | null {
  const m = postUrl.match(POST_NO_RE);
  return m?.[1] ?? null;
}

export function normalizeBlogPostUrl(blogId: string, postNo: string): string {
  return `https://blog.naver.com/${blogId}/${postNo}`;
}

/** 본문·link_url 기준 외부 링크 개수 (네이버 블로그 내부 제외) */
export function countExternalLinks(content: string | null | undefined, linkUrl?: string | null): number {
  let count = 0;
  const seen = new Set<string>();

  const add = (raw: string) => {
    const url = raw.trim();
    if (!url || seen.has(url)) return;
    if (/^https?:\/\//i.test(url) && !/blog\.naver\.com|naver\.me|naver\.com\/blog/i.test(url)) {
      seen.add(url);
      count += 1;
    }
  };

  if (linkUrl?.trim()) add(linkUrl);

  const mdLinks = content?.matchAll(/\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g) ?? [];
  for (const m of mdLinks) add(m[2]);

  const bare = content?.matchAll(/https?:\/\/[^\s)\]"'<>]+/g) ?? [];
  for (const m of bare) add(m[0]);

  return count;
}

export function plainTextLength(content: string | null | undefined): number {
  if (!content?.trim()) return 0;
  return content.replace(/[#*_`~\[\]()]/g, '').replace(/\s+/g, ' ').trim().length;
}
