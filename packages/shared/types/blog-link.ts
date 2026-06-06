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

/** 실행 시 붙여넣을 URL (클릭 가능 + OG 미리보기) */
export function resolveBlogLinkUrl(
  workspace: string,
  linkUrl?: string | null,
  sourceUrl?: string | null,
): string {
  const fromLink = linkUrl?.trim() ?? '';
  const fromSource = sourceUrl?.trim() ?? '';
  if (workspace === 'yeonun') {
    const raw = fromLink || fromSource;
    if (raw && YEONUN_HOST.test(raw)) return ensureHttpsUrl(raw);
    if (raw === 'yeonun.com' || raw === 'www.yeonun.com') return 'https://yeonun.com';
    return 'https://yeonun.com';
  }
  return ensureHttpsUrl(fromLink || fromSource);
}

/** UI 짧은 표시 */
export function formatBlogLinkLabel(url: string): string {
  try {
    const u = new URL(ensureHttpsUrl(url));
    if (YEONUN_HOST.test(u.hostname)) {
      const path = u.pathname.replace(/\/$/, '');
      return path && path !== '/' ? `yeonun.com${path}` : 'yeonun.com';
    }
    return u.hostname.replace(/^www\./, '');
  } catch {
    return url.replace(/^https?:\/\//, '').split('\n')[0] ?? url;
  }
}
