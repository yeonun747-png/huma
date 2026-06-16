const WORKSPACE_BLOG_HOME: Record<string, string> = {
  yeonun: 'https://yeonun.com',
  quizoasis: 'https://myquizoasis.com',
  panana: 'https://panana.com',
};

export function ensureHttpsUrl(url: string): string {
  const t = url.trim();
  if (!t) return '';
  if (/^https?:\/\//i.test(t)) return t;
  return `https://${t.replace(/^\/\//, '')}`;
}

/** 워크스페이스별 블로그 OG 링크 — 홈페이지만 (관련 URL 아님) */
export function workspaceBlogHomeUrl(workspace: string): string {
  return WORKSPACE_BLOG_HOME[workspace] ?? WORKSPACE_BLOG_HOME.yeonun!;
}

/** post_blog DB·큐 — landing URL 기록용 (발행 시 OG 링크 삽입에는 미사용) */
export function normalizeBlogLinkUrl(workspace: string, _sourceUrl?: string): string {
  return workspaceBlogHomeUrl(workspace);
}

/** 레거시·UI — 워크스페이스 홈 URL (post_blog 발행 OG 삽입 없음) */
export function resolveBlogLinkUrl(
  workspace: string,
  _linkUrl?: string | null,
  _sourceUrl?: string | null,
): string {
  return workspaceBlogHomeUrl(workspace);
}

/** 본문 sanitize 시 제거할 URL·호스트 변형 */
export function blogLinkStripVariants(workspace: string, linkUrl?: string | null): string[] {
  const variants = new Set<string>();
  if (linkUrl?.trim()) {
    variants.add(linkUrl.trim());
    try {
      const u = new URL(linkUrl.startsWith('http') ? linkUrl : `https://${linkUrl}`);
      variants.add(u.hostname.replace(/^www\./, ''));
      variants.add(`${u.hostname}${u.pathname}`);
    } catch {
      /* ignore */
    }
  }
  const home = workspaceBlogHomeUrl(workspace);
  let host = 'yeonun.com';
  try {
    host = new URL(home).hostname.replace(/^www\./, '');
  } catch {
    /* ignore */
  }
  variants.add(host);
  variants.add(`www.${host}`);
  variants.add(home);
  variants.add(home.replace(/^https:/, 'http:'));
  return [...variants];
}

/** UI 짧은 표시 */
export function formatBlogLinkLabel(_url: string, workspace?: string | null): string {
  const ws = workspace ?? 'yeonun';
  try {
    return new URL(workspaceBlogHomeUrl(ws)).hostname.replace(/^www\./, '');
  } catch {
    return 'yeonun.com';
  }
}
