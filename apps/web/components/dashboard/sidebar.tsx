'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { NAV_ITEMS, SPEC_NAV_ITEMS, WS_LABEL, cn } from '@/lib/constants';
import { prefetchShellViews } from '@/lib/shell-routes';
import { useWorkspace } from './workspace-context';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';
import { useShellNav } from './shell-nav-context';
import { useSidebarBadges } from './use-sidebar-badges';

export function Sidebar() {
  const { shellPath, navigate } = useShellNav();
  const router = useRouter();
  const {
    workspace,
    businessUnit,
    setBusinessUnit,
    accessibleBusinessUnits,
  } = useWorkspace();
  const { admin, logout } = useAuth();
  const { badges, pendingJobs, liveAccounts } = useSidebarBadges(workspace, shellPath);

  useEffect(() => {
    prefetchShellViews();
  }, []);

  const commonNav = NAV_ITEMS.filter((n) => n.group === 'common');
  const systemNav = NAV_ITEMS.filter((n) => n.group === 'system');
  const specNav = SPEC_NAV_ITEMS[workspace] ?? [];

  const getBadge = (key?: string) => {
    if (!key) return undefined;
    const val = badges[key as keyof typeof badges];
    return val > 0 ? val : undefined;
  };

  return (
    <aside className="relative z-10 flex h-screen w-[218px] min-w-[218px] flex-col border-r border-huma-bdr bg-huma-sb">
      <div className="border-b border-huma-bdr px-4 py-4">
        <div className="font-sans text-[25px] font-bold tracking-[0.25em] text-huma-acc">HUMA</div>
        <div className="mt-0.5 font-mono text-[9.5px] uppercase tracking-[0.2em] text-huma-t3">
          Studio v3.27 · Human Automation
        </div>
      </div>

      {accessibleBusinessUnits.length > 0 && (
        <div className="mx-2.5 my-2 flex flex-col gap-1 rounded-lg border border-huma-bdr bg-huma-bg3 p-1">
          {accessibleBusinessUnits.length > 1 &&
            accessibleBusinessUnits.map((unit) => (
              <button
                key={unit.id}
                type="button"
                onClick={() => setBusinessUnit(unit.id)}
                className={cn(
                  'group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[13.5px] font-medium transition',
                  businessUnit === unit.id
                    ? 'bg-[var(--glow)] font-bold text-huma-acc'
                    : 'text-huma-t2 hover:bg-[var(--glow)] hover:text-huma-t',
                )}
              >
                <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', unit.dotClass)} />
                {unit.label}
                <span
                  className="ml-auto flex h-4 w-4 items-center justify-center rounded border border-huma-err bg-[var(--err-bg)] text-[9px] text-huma-err opacity-0 transition group-hover:opacity-100"
                  title={`${unit.short} 긴급정지`}
                  onClick={(e) => {
                    e.stopPropagation();
                    const reason = window.prompt(`${unit.short} 서비스를 즉시 정지합니다.\n정지 이유를 입력하세요:`);
                    if (reason?.trim()) void api.stopAll(reason.trim());
                  }}
                >
                  ■
                </span>
              </button>
            ))}

          {accessibleBusinessUnits.length === 1 && (
            <div className="flex items-center gap-2 px-2 py-1.5 text-[13.5px] font-bold text-huma-acc">
              <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', accessibleBusinessUnits[0].dotClass)} />
              {accessibleBusinessUnits[0].label}
            </div>
          )}
        </div>
      )}

      <nav className="flex-1 overflow-y-auto px-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="px-2 py-2 font-mono text-[9px] uppercase tracking-[0.2em] text-huma-t3">공통</div>
        {commonNav.map((item) => {
          const active = shellPath === item.href;
          const badge = getBadge(item.badgeKey);
          return (
            <Link
              key={item.href}
              href={item.href}
              prefetch
              onClick={(e) => {
                e.preventDefault();
                navigate(item.href);
              }}
              className={active ? 'nav-item-active' : 'nav-item'}
            >
              <span className="w-4 shrink-0 text-center text-[13.5px]">{item.icon}</span>
              {item.label}
              {badge !== undefined && (
                <span
                  className={cn(
                    'ml-auto rounded-full px-1.5 py-px font-mono text-[9.5px] font-semibold text-white',
                    item.badgeErr ? 'bg-huma-err' : 'bg-huma-acc',
                  )}
                >
                  {badge}
                </span>
              )}
              {item.live && liveAccounts > 0 && (
                <span className="ml-auto animate-blink rounded-full bg-huma-err px-1.5 py-px font-mono text-[9px] font-semibold text-white">
                  LIVE{liveAccounts}
                </span>
              )}
            </Link>
          );
        })}

        {specNav.length > 0 && (
          <>
            <div className="mt-1 px-2 py-2 font-mono text-[9px] uppercase tracking-[0.2em] text-huma-t3">
              {WS_LABEL[workspace] ?? workspace} 특화
            </div>
            {specNav.map((item) => {
              const active = shellPath === item.href;
              const badge = getBadge(item.badgeKey);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  prefetch
                  onClick={(e) => {
                e.preventDefault();
                navigate(item.href);
              }}
                  className={active ? 'nav-item-active' : 'nav-item'}
                >
                  <span className="w-4 shrink-0 text-center text-[13.5px]">{item.icon}</span>
                  {item.label}
                  {badge !== undefined && (
                    <span className="ml-auto rounded-full bg-huma-acc px-1.5 py-px font-mono text-[9.5px] font-semibold text-white">
                      {badge}
                    </span>
                  )}
                </Link>
              );
            })}
          </>
        )}

        <div className="mt-1 px-2 py-2 font-mono text-[9px] uppercase tracking-[0.2em] text-huma-t3">시스템</div>
        {systemNav.map((item) => {
          const active = shellPath === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              prefetch
              onClick={(e) => {
                e.preventDefault();
                navigate(item.href);
              }}
              className={active ? 'nav-item-active' : 'nav-item'}
            >
              <span className="w-4 shrink-0 text-center text-[13.5px]">{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-huma-bdr px-2.5 py-2.5">
        <div className="flex items-center gap-2 rounded-md bg-huma-bg3 px-2 py-1.5">
          <div className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-huma-ok" />
          <div>
            <div className="text-[12px] font-semibold text-huma-t2">시스템 정상</div>
            <div className="text-[10.5px] text-huma-t3">큐 활성 · {pendingJobs}개 대기</div>
          </div>
        </div>
      </div>

      <div className="border-t border-huma-bdr2 bg-huma-sb px-2.5 py-3">
        <div className="mb-2 flex items-center gap-2">
          <div className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full bg-huma-acc text-[12px] font-bold text-white">
            {(admin?.name ?? 'A').charAt(0)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12.5px] font-semibold text-huma-t">{admin?.name ?? '관리자'}</div>
            <div className="truncate font-mono text-[10.5px] text-huma-t3">
              {admin?.email ?? (accessibleBusinessUnits.map((u) => u.short).join(', ') || '—')}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            logout();
            router.push('/login');
          }}
          className="btn-ghost w-full py-1 font-mono text-[10px]"
        >
          로그아웃
        </button>
      </div>
    </aside>
  );
}
