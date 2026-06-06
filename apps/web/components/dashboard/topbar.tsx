'use client';

import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { BUSINESS_UNITS } from '@/lib/admin-scope';
import { getPageMeta } from '@/lib/page-config';
import { useWorkspace } from './workspace-context';
import { api } from '@/lib/api';
import { useDashboardPeriod } from './dashboard-period-context';
import { TOPBAR_NEXT_PUBLISH, TOPBAR_NOTIFICATIONS } from '@/lib/topbar-mock-data';
import { formatKstClock, formatLogKstTime } from '@/lib/format-kst';

type NotifItem = { type: 'err' | 'warn'; title: string; sub: string };

export function Topbar({ title }: { title: string }) {
  const pathname = usePathname();
  const meta = getPageMeta(pathname);
  const { businessUnit } = useWorkspace();
  const unitLabel = BUSINESS_UNITS.find((u) => u.id === businessUnit)?.label ?? businessUnit;
  const breadcrumb = `HUMA › ${unitLabel} › ${title}`;
  const { period, setPeriod } = useDashboardPeriod();
  const [notifOpen, setNotifOpen] = useState(false);
  const [clock, setClock] = useState('');
  const [systemPaused, setSystemPaused] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [nextPublish, setNextPublish] = useState(TOPBAR_NEXT_PUBLISH);
  const [notifications, setNotifications] = useState<NotifItem[]>(TOPBAR_NOTIFICATIONS);

  const loadMeta = useCallback(() => {
    void api.dashboardStats({ period: 'today' }).then((s) => {
      if (s.nextPublish) setNextPublish(s.nextPublish);
    }).catch(() => {});

    void api.logs({ level: 'ERROR', limit: '8' }).then((logs) => {
      if (!logs.length) return;
      setNotifications(
        logs.slice(0, 5).map((log) => {
          const ws = String(log.workspace ?? 'HUMA');
          const time = formatLogKstTime(String(log.created_at ?? ''));
          const msg = String(log.message ?? '오류');
          const isLayer4 = msg.includes('Layer4') || msg.includes('캡차');
          return {
            type: isLayer4 ? ('warn' as const) : ('err' as const),
            title: msg.slice(0, 60),
            sub: `${ws} · ${time}`,
          };
        }),
      );
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const tick = () => {
      setClock(formatKstClock());
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    api.status({ workspace: businessUnit }).then((s) => {
      setSystemPaused(Boolean(s.paused));
      setPendingCount(s.pendingJobs ?? 0);
    }).catch(() => {});
    loadMeta();
    const id = setInterval(loadMeta, 60_000);
    return () => clearInterval(id);
  }, [businessUnit, loadMeta]);

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-huma-bdr bg-huma-bg2 px-[18px] transition-all duration-300">
      <div>
        <h1 className="font-display text-[19.5px] tracking-[0.15em] text-huma-acc">{title}</h1>
        <p className="font-mono text-[11px] text-huma-t3">{breadcrumb}</p>
      </div>

      <div className="ml-auto flex items-center gap-2">
        <div className="hidden shrink-0 items-center gap-1.5 rounded-md border border-huma-bdr2 bg-huma-bg3 px-2.5 py-1 font-mono sm:flex">
          <span className="text-[12px] font-semibold text-huma-t2">{clock}</span>
          <span className="text-[10px] text-huma-t4">│</span>
          <span className="text-[10px] text-huma-t3">다음발행</span>
          <span className="text-[12px] font-bold text-huma-acc">{nextPublish}</span>
        </div>

        {meta.showPeriod && (
          <div className="flex gap-0.5 rounded-md bg-huma-bg3 p-0.5">
            {(['today', 'week', 'month'] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPeriod(p)}
                className={`rounded px-2.5 py-1 text-[12px] transition ${
                  period === p ? 'bg-huma-acc font-bold text-white' : 'text-huma-t3 hover:text-huma-t2'
                }`}
              >
                {p === 'today' ? '오늘' : p === 'week' ? '이번주' : '이번달'}
              </button>
            ))}
          </div>
        )}

        <div className="relative">
          <button
            type="button"
            onClick={() => setNotifOpen(!notifOpen)}
            className="flex h-8 w-8 items-center justify-center rounded-md border border-huma-bdr bg-huma-bg3 text-sm text-huma-t2 transition hover:border-huma-acc hover:text-huma-acc"
          >
            🔔
          </button>
          {notifications.length > 0 && (
            <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-huma-err font-mono text-[9.5px] font-bold text-white">
              {notifications.length}
            </span>
          )}
          {notifOpen && (
            <div className="absolute right-0 top-10 z-50 w-[300px] rounded-xl border border-huma-bdr bg-huma-bg2 shadow-panel">
              <div className="flex items-center justify-between border-b border-huma-bdr px-3.5 py-2.5 text-[12.5px] font-bold">
                알림 센터
                <button
                  type="button"
                  className="text-[11.5px] text-huma-t3 hover:text-huma-acc"
                  onClick={() => setNotifOpen(false)}
                >
                  모두 읽음
                </button>
              </div>
              {notifications.length === 0 ? (
                <p className="px-3.5 py-4 text-[12px] text-huma-t3">최근 오류 없음</p>
              ) : (
                notifications.map((n) => (
                  <div key={`${n.title}-${n.sub}`} className="flex gap-2.5 border-b border-huma-bdr2 px-3.5 py-2.5 last:border-0">
                    <div className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${n.type === 'err' ? 'bg-huma-err' : 'bg-huma-warn'}`} />
                    <div>
                      <div className="text-[13px] font-medium text-huma-t">{n.title}</div>
                      <div className="font-mono text-[11.5px] text-huma-t3">{n.sub}</div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {systemPaused ? (
          <button
            type="button"
            className="btn-ghost"
            onClick={() => {
              const ok = window.confirm(
                `대기 중이던 큐 ${pendingCount}건은 그대로 유지됩니다.\n다음 스케줄부터 자동 재개됩니다.\n재시작하시겠습니까?`,
              );
              if (!ok) return;
              api.resumeAll().then(() => setSystemPaused(false));
            }}
          >
            ▶ 재시작
          </button>
        ) : (
          <button
            type="button"
            className="btn-ghost"
            onClick={() => {
              const reason = window.prompt(
                'HUMA 전체를 정지합니다.\n정지 이유를 입력하세요 (Operation Log에 기록됩니다):',
              );
              if (reason === null || !reason.trim()) return;
              api.stopAll(reason.trim()).then(() => setSystemPaused(true));
            }}
          >
            ⏹ 전체 중지
          </button>
        )}
      </div>
    </header>
  );
}
