'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import type { Workspace } from '@huma/shared';
import { useWorkspace } from './workspace-context';

/** WS 전용 페이지 — 해당 워크스페이스가 아니면 대시보드로 */
const WS_ONLY: Partial<Record<string, Workspace>> = {
  '/cafe-viral': 'yeonun',
  '/adsense': 'quizoasis',
};

const REMOVED_ROUTES = ['/scenario', '/social'];

export function WorkspaceRouteGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { workspace } = useWorkspace();

  useEffect(() => {
    if (REMOVED_ROUTES.includes(pathname)) {
      router.replace('/dashboard');
      return;
    }
    const required = WS_ONLY[pathname];
    if (required && workspace !== required) {
      router.replace('/dashboard');
    }
  }, [pathname, workspace, router]);

  return children;
}
