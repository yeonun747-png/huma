/** 블로그 공개 목록 제목 — DB(huma_jobs/posts) 제목보다 노출 검색에 우선 */
export function preferBlogListTitleForSearch(
  blogListTitle: string | null | undefined,
  dbTitle: string | null | undefined,
): string | null {
  const live = blogListTitle?.trim();
  if (live && live !== '—') return live;
  return dbTitle?.trim() || null;
}
