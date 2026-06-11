'use client';

import dynamic from 'next/dynamic';
import { Suspense, useMemo, type ComponentType, type ReactNode } from 'react';
import { getPageMeta } from '@/lib/page-config';
import { SHELL_VIEW_LOADERS, isShellRoute } from '@/lib/shell-routes';
import { useShellNav } from './shell-nav-context';
import { ShellPageSkeleton } from './shell-page-skeleton';

const viewCache = new Map<string, ComponentType<object>>();

function resolveShellView(path: string): ComponentType<object> | null {
  const loader = SHELL_VIEW_LOADERS[path];
  if (!loader) return null;

  const cached = viewCache.get(path);
  if (cached) return cached;

  const View = dynamic(loader, {
    loading: () => <ShellPageSkeleton title={getPageMeta(path).title} />,
  });
  viewCache.set(path, View);
  return View;
}

export function ShellContent({ fallback }: { fallback?: ReactNode }) {
  const { shellPath } = useShellNav();

  const View = useMemo(
    () => (isShellRoute(shellPath) ? resolveShellView(shellPath) : null),
    [shellPath],
  );

  if (!View) return <>{fallback}</>;

  const page = <View key={shellPath} />;

  if (shellPath === '/queue') {
    return <Suspense fallback={<ShellPageSkeleton title="큐 관리" />}>{page}</Suspense>;
  }

  return page;
}
