'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { getAccessibleWorkspaces } from '@/lib/constants';
import { useAuth } from '@/lib/auth-context';
import { useWorkspace } from '@/components/dashboard/workspace-context';
import { EmptyPanel } from '@/components/ui/empty-panel';
import { MGrid, MPanel, MStat, MTable, MTag, MUrlLink } from '@/components/mockup/primitives';

const WS_META: Record<string, { icon: string; name: string }> = {
  yeonun: { icon: '🔮', name: '연운 緣運' },
  quizoasis: { icon: '🧠', name: '퀴즈오아시스' },
  panana: { icon: '🎬', name: '파나나' },
};

export function DashboardHome() {
  const { admin } = useAuth();
  const { workspace } = useWorkspace();
  const accessible = getAccessibleWorkspaces(admin);
  const [stats, setStats] = useState({ pendingJobs: 0, activeAccounts: 0, errors: 0, todayCompleted: 0 });
  const [serviceStats, setServiceStats] = useState<Array<{ workspace: string; todayJobs: number; pending: number; errors: number }>>([]);
  const [chart, setChart] = useState<{ day: string; value: number }[]>([]);
  const [recent, setRecent] = useState<Array<{ title: string; status: string; result_url?: string; workspace: string }>>([]);

  useEffect(() => {
    api.dashboardStats().then((d) => {
      setServiceStats(d.serviceStats);
      setChart(d.chart);
      setStats({ pendingJobs: d.pendingJobs, activeAccounts: d.activeAccounts, errors: d.errors, todayCompleted: d.todayCompleted });
    }).catch(() => {});
    api.dashboardRecent().then(setRecent).catch(() => setRecent([]));
  }, []);

  const serviceCards = accessible.map((ws) => {
    const stat = serviceStats.find((s) => s.workspace === ws.id);
    const meta = WS_META[ws.id];
    const status = (stat?.errors ?? 0) > 0 ? 'err' : (stat?.pending ?? 0) > 5 ? 'warn' : 'ok';
    return { ...ws, meta, stat, status };
  });

  const maxChart = Math.max(...chart.map((c) => c.value), 1);
  const workspaceRecent = recent.filter((r) => r.workspace === workspace);

  return (
    <div className="animate-fadeIn">
      <div className="m-status-bar">
        {serviceCards.map((svc) => (
          <div key={svc.id} className={`m-status-card st-${svc.status === 'ok' ? 'ok' : svc.status === 'warn' ? 'warn' : 'err'}`}>
            <span className="text-lg">{svc.meta?.icon}</span>
            <div className="min-w-0 flex-1">
              <div className="m-st-name">{svc.meta?.name}</div>
              <div className="m-st-detail">대기 {svc.stat?.pending ?? 0} · 오류 {svc.stat?.errors ?? 0}</div>
            </div>
            <div className="flex flex-col items-end">
              <div className={`m-st-jobs ${svc.status === 'err' ? 'err' : ''}`}>{svc.stat?.todayJobs ?? 0}</div>
              <div className="m-st-jobs-l">{svc.status === 'err' ? '오류 발생' : '오늘 발행'}</div>
              <button type="button" className="m-svc-stop" onClick={() => api.stopAll()}>■ 정지</button>
            </div>
          </div>
        ))}
      </div>

      <MGrid cols={4}>
        <MStat label="오늘 총 발행" value={stats.todayCompleted} sub="API 집계" />
        <MStat label="큐 대기" value={stats.pendingJobs} sub="활성" />
        <MStat label="오류" value={stats.errors} tone={stats.errors > 0 ? 'err' : undefined} sub="Layer4·실패 작업" />
        <MStat label="활성 계정" value={stats.activeAccounts} sub="등록된 posting 계정" />
      </MGrid>

      <MGrid cols={2}>
        <MPanel title={<><span>7일 발행수 추이</span><span className="ml-auto text-[10.5px] normal-case tracking-normal text-huma-acc">오늘 기준</span></>}>
          {chart.length === 0 ? (
            <EmptyPanel message="발행 이력이 없습니다" />
          ) : (
            <div className="m-bar-chart">
              {chart.map((c) => (
                <div key={c.day} className="m-bar-col">
                  <div className="m-bar-fill" style={{ height: `${Math.max(4, (c.value / maxChart) * 100)}%` }} title={`${c.value}`} />
                  <div className="m-bar-label">{c.day}</div>
                </div>
              ))}
            </div>
          )}
        </MPanel>
        <MPanel title="최근 완료 작업">
          {workspaceRecent.length === 0 ? (
            <EmptyPanel message="완료된 작업이 없습니다" />
          ) : (
            <MTable
              head={['제목', '상태', 'URL']}
              rows={workspaceRecent.slice(0, 5).map((r) => [
                r.title,
                <MTag key="s" tone={r.status === 'completed' ? 'ok' : r.status === 'failed' ? 'err' : 'warn'}>{r.status === 'completed' ? '완료' : r.status}</MTag>,
                r.result_url ? <MUrlLink href={r.result_url}>링크 ↗</MUrlLink> : '—',
              ])}
            />
          )}
        </MPanel>
      </MGrid>
    </div>
  );
}
