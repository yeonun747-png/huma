'use client';

import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { WORKSPACES } from '@/lib/constants';
import { getPageMeta } from '@/lib/page-config';
import { useWorkspace } from './workspace-context';
import { api } from '@/lib/api';
import { usePageAction } from './page-action-context';
import { useHumanEngineSave } from './human-engine-save-context';

const NOTIFICATIONS = [
  { type: 'err', title: 'panana_sora TikTok 세션 만료', sub: '파나나 · 14:14 · 재연결 필요' },
  { type: 'warn', title: 'yeonun_crank 응답 지연 감지', sub: '연운 · 14:13 · 2.1s 딜레이' },
  { type: 'err', title: 'Layer4 캡차 감지 → 자동 중지', sub: '연운 · 11:23 · 복구 완료' },
];

export function Topbar({ title }: { title: string }) {
  const pathname = usePathname();
  const meta = getPageMeta(pathname);
  const { workspace, businessUnit } = useWorkspace();
  const wsMeta = WORKSPACES.find((w) => w.id === workspace);
  const breadcrumb =
    businessUnit === 'yeonun'
      ? `HUMA › 연운 › ${title}`
      : `HUMA › 퀴즈+파나나 › ${wsMeta?.short ?? workspace} › ${title}`;
  const [period, setPeriod] = useState<'today' | 'week' | 'month'>('today');
  const [notifOpen, setNotifOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const pageAction = usePageAction();
  const humanSave = useHumanEngineSave();

  const handlePrimary = async () => {
    setBusy(true);
    try {
      if (meta.actionType === 'saveHuman' && humanSave) {
        await humanSave.save();
        return;
      }
      if (meta.actionType === 'resumeAll') {
        await api.resumeAll();
        return;
      }
      if (pageAction) {
        await pageAction.run(meta.actionType);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-huma-bdr bg-huma-bg2 px-[18px] transition-all duration-300">
      <div>
        <h1 className="font-display text-[19.5px] tracking-[0.15em] text-huma-acc">{title}</h1>
        <p className="font-mono text-[11px] text-huma-t3">{breadcrumb}</p>
      </div>

      <div className="ml-auto flex items-center gap-2">
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
          <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-huma-err font-mono text-[9.5px] font-bold text-white">
            3
          </span>
          {notifOpen && (
            <div className="absolute right-0 top-10 z-50 w-[300px] rounded-xl border border-huma-bdr bg-huma-bg2 shadow-panel">
              <div className="flex items-center justify-between border-b border-huma-bdr px-3.5 py-2.5 text-[12.5px] font-bold">
                알림 센터
                <button type="button" className="text-[11.5px] text-huma-t3" onClick={() => setNotifOpen(false)}>
                  닫기
                </button>
              </div>
              {NOTIFICATIONS.map((n) => (
                <div key={n.title} className="flex gap-2.5 border-b border-huma-bdr2 px-3.5 py-2.5 last:border-0">
                  <div className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${n.type === 'err' ? 'bg-huma-err' : 'bg-huma-warn'}`} />
                  <div>
                    <div className="text-[13px] font-medium text-huma-t">{n.title}</div>
                    <div className="font-mono text-[11.5px] text-huma-t3">{n.sub}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <button type="button" className="btn-ghost" onClick={() => api.stopAll()}>⏹ 전체 중지</button>
        <button type="button" className="btn-primary" onClick={handlePrimary} disabled={busy}>
          {busy ? '처리 중…' : meta.action}
        </button>
      </div>
    </header>
  );
}
