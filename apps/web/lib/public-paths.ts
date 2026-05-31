/** 로그인 없이 접근 가능한 경로 */
export const PUBLIC_PATHS = ['/login', '/privacy', '/terms', '/legal/privacy', '/legal/terms'] as const;

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
