export function normalizeBlogUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

export function requiresPostingBlogUrl(accountType: string | undefined | null): boolean {
  return accountType === 'posting';
}

export const POSTING_BLOG_URL_REQUIRED_MSG = '포스팅 계정은 블로그 URL이 필수입니다.';

/** 등록 시에는 수동 입력 없이 i7 자동 수집 가능 */
export function requiresPostingBlogUrlOnCreate(): boolean {
  return false;
}
