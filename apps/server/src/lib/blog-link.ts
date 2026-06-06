/** 네이버 블로그 별도 타이핑 링크 — 연운은 yeonun.com 도메인만 */
export function normalizeBlogLinkUrl(workspace: string, sourceUrl: string): string {
  if (workspace === 'yeonun') return 'yeonun.com';
  return sourceUrl.trim();
}
