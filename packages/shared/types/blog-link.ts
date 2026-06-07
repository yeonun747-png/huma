const YEONUN_HOST = /yeonun\.(com|ai)/i;

export function ensureHttpsUrl(url: string): string {
  const t = url.trim();
  if (!t) return '';
  if (/^https?:\/\//i.test(t)) return t;
  return `https://${t.replace(/^\/\//, '')}`;
}

/** post_blog DB·큐 — OG 붙여넣기용 전체 URL */
export function normalizeBlogLinkUrl(workspace: string, sourceUrl: string): string {
  if (workspace === 'yeonun') {
    const u = sourceUrl.trim();
    if (u && YEONUN_HOST.test(u)) return ensureHttpsUrl(u);
    return 'https://yeonun.com';
  }
  return ensureHttpsUrl(sourceUrl);
}

/** post_blog·Playwright — 본문 붙여넣기용 전체 URL (연운 포함 OG 카드) */
export function resolveBlogLinkUrl(
  workspace: string,
  linkUrl?: string | null,
  sourceUrl?: string | null,
): string {
  const fromLink = linkUrl?.trim() ?? '';
  const fromSource = sourceUrl?.trim() ?? '';
  const raw = fromLink || fromSource;
  if (workspace === 'yeonun') return normalizeBlogLinkUrl(workspace, raw);
  return ensureHttpsUrl(raw);
}

/** UI 짧은 표시 */
export function formatBlogLinkLabel(url: string, workspace?: string | null): string {
  if (workspace === 'yeonun') return 'yeonun.com';
  try {
    const u = new URL(ensureHttpsUrl(url));
    if (YEONUN_HOST.test(u.hostname)) return 'yeonun.com';
    return u.hostname.replace(/^www\./, '');
  } catch {
    return url.replace(/^https?:\/\//, '').split('\n')[0] ?? url;
  }
}
