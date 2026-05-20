'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { NAV_ITEMS, cn } from '@/lib/constants';
import { useWorkspace } from './workspace-context';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { workspace, setWorkspace, accessibleWorkspaces } = useWorkspace();
  const { admin, logout } = useAuth();
  const [badges, setBadges] = useState({ queue: 0, video: 0, watcher: 0 });
  const [pendingJobs, setPendingJobs] = useState(0);

  useEffect(() => {
    api.navBadges().then(setBadges).catch(() => {});
    api.status().then((s) => setPendingJobs(s.pendingJobs)).catch(() => {});
    const t = setInterval(() => {
      api.navBadges().then(setBadges).catch(() => {});
      api.status().then((s) => setPendingJobs(s.pendingJobs)).catch(() => {});
    }, 30000);
    return () => clearInterval(t);
  }, [workspace]);

  const commonNav = NAV_ITEMS.filter((n) => n.group === 'common');
  const systemNav = NAV_ITEMS.filter((n) => n.group === 'system');

  const getBadge = (key?: string) => {
    if (!key) return undefined;
    const val = badges[key as keyof typeof badges];
    return val > 0 ? val : undefined;
  };

  return (
    <aside className="relative z-10 flex h-screen w-[218px] min-w-[218px] flex-col border-r border-huma-bdr bg-huma-sb pb-[90px]">
      <div className="border-b border-huma-bdr px-4 py-4">
        <div className="font-display text-[22px] tracking-[0.25em] text-huma-acc">HUMA</div>
        <div className="mt-0.5 font-mono text-[8.5px] uppercase tracking-[0.2em] text-huma-t3">
          Studio v1 · Human Automation
        </div>
      </div>

      {accessibleWorkspaces.length > 0 && (
      <div className="mx-2.5 my-2 flex flex-col gap-0.5 rounded-lg border border-huma-bdr bg-huma-bg3 p-1">
        {accessibleWorkspaces.map((ws) => (
          <button
            key={ws.id}
            type="button"
            onClick={() => setWorkspace(ws.id)}
            className={cn(
              'group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs font-medium transition',
              workspace === ws.id
                ? 'bg-[var(--glow)] font-bold text-huma-acc'
                : 'text-huma-t2 hover:bg-[var(--glow)] hover:text-huma-t'
            )}
          >
            <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', ws.dotClass)} />
            {ws.label}
            <span
              className="ml-auto flex h-4 w-4 items-center justify-center rounded border border-huma-err bg-[var(--err-bg)] text-[8px] text-huma-err opacity-0 transition group-hover:opacity-100"
              title={`${ws.short} 긴급정지`}
              onClick={(e) => { e.stopPropagation(); api.stopAll(); }}
            >
              ■
            </span>
          </button>
        ))}
      </div>
      )}

      <nav className="flex-1 overflow-y-auto px-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="px-2 py-2 font-mono text-[8px] uppercase tracking-[0.2em] text-huma-t3">공통</div>
        {commonNav.map((item) => {
          const active = pathname === item.href;
          const badge = getBadge(item.badgeKey);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={active ? 'nav-item-active' : 'nav-item'}
            >
              <span className="w-4 shrink-0 text-center text-xs">{item.icon}</span>
              {item.label}
              {badge !== undefined && (
                <span
                  className={cn(
                    'ml-auto rounded-full px-1.5 py-px font-mono text-[8.5px] font-semibold text-white',
                    item.badgeErr ? 'bg-huma-err' : 'bg-huma-acc'
                  )}
                >
                  {badge}
                </span>
              )}
              {item.live && (
                <span className="ml-auto animate-blink rounded-full bg-huma-err px-1.5 py-px font-mono text-[8px] text-white">
                  LIVE
                </span>
              )}
            </Link>
          );
        })}

        <div className="mt-1 px-2 py-2 font-mono text-[8px] uppercase tracking-[0.2em] text-huma-t3">시스템</div>
        {systemNav.map((item) => {
          const active = pathname === item.href;
          return (
            <Link key={item.href} href={item.href} className={active ? 'nav-item-active' : 'nav-item'}>
              <span className="w-4 shrink-0 text-center text-xs">{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="absolute bottom-0 left-0 right-0 border-t border-huma-bdr2 bg-huma-sb p-3">
        <div className="mb-2 flex items-center gap-2">
          <div className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full bg-huma-acc text-[10px] font-bold text-white">
            {(admin?.name ?? 'A').charAt(0)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[11px] font-semibold text-huma-t">{admin?.name ?? '관리자'}</div>
            <div className="font-mono text-[9px] text-huma-t3">
              {accessibleWorkspaces.map((ws) => ws.short).join(', ') || '—'}
            </div>
          </div>
        </div>
        <button type="button" onClick={() => { logout(); router.push('/login'); }} className="btn-ghost w-full py-1 font-mono text-[10px]">
          로그아웃
        </button>
      </div>

      <div className="border-t border-huma-bdr px-2.5 py-2.5">
        <div className="flex items-center gap-2 rounded-md bg-huma-bg3 px-2 py-1.5">
          <div className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-huma-ok" />
          <div>
            <div className="text-[10.5px] font-semibold text-huma-t2">시스템 정상</div>
            <div className="text-[9px] text-huma-t3">큐 활성 · {pendingJobs}개 대기</div>
          </div>
        </div>
      </div>
    </aside>
  );
}
