'use client';

import dynamic from 'next/dynamic';
import { Suspense, useEffect, useMemo, useState, type ComponentType, type ReactNode } from 'react';
import { getPageMeta } from '@/lib/page-config';
import { SHELL_VIEW_LOADERS, isShellRoute, type ShellViewLoader } from '@/lib/shell-routes';
import { useShellNav } from './shell-nav-context';
import { ShellPageSkeleton } from './shell-page-skeleton';
import { ShellViewPathProvider } from './shell-view-active';

const viewCache = new Map<string, { loader: ShellViewLoader; View: ComponentType<object> }>();
const MAX_KEEP_ALIVE = 8;

function resolveShellView(path: string): ComponentType<object> | null {
  const loader = SHELL_VIEW_LOADERS[path];
  if (!loader) return null;

  const cached = viewCache.get(path);
  if (cached?.loader === loader) return cached.View;

  const View = dynamic(loader, {
    loading: () => <ShellPageSkeleton title={getPageMeta(path).title} />,
  });
  viewCache.set(path, { loader, View });
  return View;
}

function ShellViewSlot({ path, active }: { path: string; active: boolean }) {
  const View = useMemo(() => resolveShellView(path), [path]);
  if (!View) return null;

  const page = (
    <ShellViewPathProvider path={path}>
      <View />
    </ShellViewPathProvider>
  );

  const inner =
    path === '/queue' ? (
      <Suspense fallback={<ShellPageSkeleton title="포스팅 큐 관리" />}>{page}</Suspense>
    ) : (
      page
    );

  return (
    <div
      className={active ? undefined : 'hidden'}
      aria-hidden={!active}
      data-shell-view={path}
    >
      {inner}
    </div>
  );
}

export function ShellContent({ fallback }: { fallback?: ReactNode }) {
  const { shellPath } = useShellNav();
  const [visitOrder, setVisitOrder] = useState<string[]>(() =>
    isShellRoute(shellPath) ? [shellPath] : [],
  );

  useEffect(() => {
    if (!isShellRoute(shellPath)) return;
    setVisitOrder((prev) => {
      const next = [shellPath, ...prev.filter((p) => p !== shellPath)];
      return next.slice(0, MAX_KEEP_ALIVE);
    });
  }, [shellPath]);

  if (!isShellRoute(shellPath)) return <>{fallback}</>;

  return (
    <>
      {visitOrder.map((path) => (
        <ShellViewSlot key={path} path={path} active={path === shellPath} />
      ))}
    </>
  );
}
