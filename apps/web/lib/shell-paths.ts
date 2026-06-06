import { isPublicPath } from '@/lib/public-paths';

/** AppShell(사이드바·탑바) 없이 풀화면으로 보여줄 인증 경로 */
const STANDALONE_PATHS = ['/posting-preview'] as const;

export function usesDashboardShell(pathname: string): boolean {
  if (isPublicPath(pathname)) return false;
  return !STANDALONE_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
