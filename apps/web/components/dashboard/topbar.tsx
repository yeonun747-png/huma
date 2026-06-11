'use client';

import { useCallback, useEffect, useState } from 'react';
import { BUSINESS_UNITS } from '@/lib/admin-scope';
import { getPageMeta } from '@/lib/page-config';
import { useWorkspace } from './workspace-context';
import { api } from '@/lib/api';
import { useDashboardPeriod } from './dashboard-period-context';
import { formatLogKstTime, parseQueueKstParts, weekdayColorClass, type QueueKstParts } from '@/lib/format-kst';
import { KstWeekdayDatetime } from '@/components/ui/kst-weekday-datetime';
import { useShellNav } from './shell-nav-context';

type NotifItem = { type: 'err' | 'warn'; title: string; sub: string };

const NOTIF_DISMISSED_KEY = 'huma_notif_dismissed_at';

function getNotifDismissedAt(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(NOTIF_DISMISSED_KEY);
}

function isLogUnread(createdAt: string, dismissedAt: string | null): boolean {
  if (!dismissedAt) return true;
  if (!createdAt) return true;
  return new Date(createdAt).getTime() > new Date(dismissedAt).getTime();
}

export function Topbar({ title }: { title: string }) {
  const { shellPath } = useShellNav();
  const meta = getPageMeta(shellPath);
  const { businessUnit } = useWorkspace();
  const unitLabel = BUSINESS_UNITS.find((u) => u.id === businessUnit)?.label ?? businessUnit;
  const breadcrumb = `HUMA › ${unitLabel} › ${title}`;
  const { period, setPeriod } = useDashboardPeriod();
  const [notifOpen, setNotifOpen] = useState(false);
  const [clockParts, setClockParts] = useState<QueueKstParts | null>(null);
  const [systemPaused, setSystemPaused] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [nextPublishAt, setNextPublishAt] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<NotifItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  const loadMeta = useCallback(() => {
    void api.dashboardStats({ period: 'today' }).then((s) => {
      const at = s.nextPublishAt ?? null;
      if (at && new Date(at) > new Date()) {
        setNextPublishAt(at);
      } else {
        setNextPublishAt(null);
      }
    }).catch(() => {});

    void api.logs({ level: 'ERROR', limit: '8' }).then((logs) => {
      if (!logs.length) {
        setNotifications([]);
        setUnreadCount(0);
        return;
      }
      const dismissedAt = getNotifDismissedAt();
      const recent = logs.slice(0, 5);
      const items = recent.map((log) => {
        const ws = String(log.workspace ?? 'HUMA');
        const time = formatLogKstTime(String(log.created_at ?? ''));
        const msg = String(log.message ?? '오류');
        const isLayer4 = msg.includes('Layer4') || msg.includes('캡차');
        return {
          type: isLayer4 ? ('warn' as const) : ('err' as const),
          title: msg.slice(0, 60),
          sub: `${ws} · ${time}`,
        };
      });
      const unread = recent.filter((log) =>
        isLogUnread(String(log.created_at ?? ''), dismissedAt),
      ).length;
      setNotifications(items);
      setUnreadCount(unread);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const tick = () => {
      setClockParts(parseQueueKstParts(new Date().toISOString()));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    api.status({ workspace: businessUnit }).then((s) => {
      setSystemPaused(Boolean(s.paused));
      setPendingCount(s.pendingJobs ?? 0);
      if (s.nextScheduled && new Date(s.nextScheduled) > new Date()) {
        setNextPublishAt(s.nextScheduled);
      }
    }).catch(() => {});
    loadMeta();
    const id = setInterval(loadMeta, 60_000);
    return () => clearInterval(id);
  }, [businessUnit, loadMeta]);

  const markAllRead = () => {
    localStorage.setItem(NOTIF_DISMISSED_KEY, new Date().toISOString());
    setUnreadCount(0);
    setNotifOpen(false);
  };

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-huma-bdr bg-huma-bg2 px-[18px] transition-all duration-300">
      <div>
        <h1 className="font-sans text-[19.5px] font-bold tracking-[0.15em] text-huma-acc">{title}</h1>
        <p className="font-mono text-[11px] text-huma-t3">{breadcrumb}</p>
      </div>

      <div className="ml-auto flex items-center gap-2">
        <div className="hidden shrink-0 items-center gap-1.5 rounded-md border border-huma-bdr2 bg-huma-bg3 px-2.5 py-1 font-mono sm:flex">
          <span className="text-[11px] font-semibold">
            {clockParts ? (
              <>
                <span className="text-huma-t2">{clockParts.date}</span>
                <span className={weekdayColorClass(clockParts.weekday)}>({clockParts.weekday})</span>{' '}
                <span className="text-huma-t2">{clockParts.time}</span>
              </>
            ) : (
              <span className="text-huma-t2">—</span>
            )}
          </span>
          <span className="text-[10px] text-huma-t4">│</span>
          <span className="text-[10px] text-huma-t3">다음발행</span>
          <span className="text-[11px]">
            <KstWeekdayDatetime iso={nextPublishAt} tone="accent" />
          </span>
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
          {unreadCount > 0 && (
            <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-huma-err font-mono text-[9.5px] font-bold text-white">
              {unreadCount}
            </span>
          )}
          {notifOpen && (
            <div className="absolute right-0 top-10 z-50 w-[300px] rounded-xl border border-huma-bdr bg-huma-bg2 shadow-panel">
              <div className="flex items-center justify-between border-b border-huma-bdr px-3.5 py-2.5 text-[12.5px] font-bold">
                알림 센터
                <button
                  type="button"
                  className="text-[11.5px] text-huma-t3 hover:text-huma-acc"
                  onClick={markAllRead}
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
                `대기 중이던 큐 ${pendingCount}건은 그대로 유지됩니다.\n당일 C-Rank 큐가 없으면 자동 보정됩니다.\n재시작하시겠습니까?`,
              );
              if (!ok) return;
              api.resumeAll().then(() => {
                setSystemPaused(false);
                loadMeta();
              });
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
