'use client';

import { useEffect, useState } from 'react';
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { WORKSPACES, cn, getAccessibleWorkspaces } from '@/lib/constants';
import { api } from '@/lib/api';
import { LogViewer } from '@/components/charts/log-viewer';
import { useAuth } from '@/lib/auth-context';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

type ServiceStat = { workspace: string; todayJobs: number; pending: number; errors: number };
type RecentPost = { title: string; status: string; result_url?: string; workspace: string; completed_at?: string };

const WS_META: Record<string, { icon: string; name: string }> = {
  yeonun: { icon: '🔮', name: '연운 緣運' },
  quizoasis: { icon: '🧠', name: '퀴즈오아시스' },
  panana: { icon: '🎬', name: '파나나' },
};

export function DashboardHome() {
  const { admin } = useAuth();
  const accessible = getAccessibleWorkspaces(admin);
  const [stats, setStats] = useState({
    pendingJobs: 0,
    activeAccounts: 0,
    errors: 0,
    todayCompleted: 0,
    healthy: true,
    queueActive: true,
    paused: false,
  });
  const [serviceStats, setServiceStats] = useState<ServiceStat[]>([]);
  const [chart, setChart] = useState<{ day: string; value: number }[]>([]);
  const [recent, setRecent] = useState<RecentPost[]>([]);

  useEffect(() => {
    api.status().then((s) => setStats((prev) => ({ ...prev, ...s }))).catch(() => {});
    api.dashboardStats().then((d) => {
      setServiceStats(d.serviceStats);
      setChart(d.chart);
      setStats((prev) => ({
        ...prev,
        pendingJobs: d.pendingJobs,
        activeAccounts: d.activeAccounts,
        errors: d.errors,
        todayCompleted: d.todayCompleted,
      }));
    }).catch(() => {});
    api.dashboardRecent().then(setRecent).catch(() => {});
  }, []);

  const serviceCards = accessible.map((ws) => {
    const stat = serviceStats.find((s) => s.workspace === ws.id);
    const meta = WS_META[ws.id];
    const status = (stat?.errors ?? 0) > 0 ? 'err' : (stat?.pending ?? 0) > 5 ? 'warn' : 'ok';
    return {
      id: ws.id,
      icon: meta?.icon ?? '⬡',
      name: meta?.name ?? ws.label,
      detail: `대기 ${stat?.pending ?? 0} · 오류 ${stat?.errors ?? 0}`,
      jobs: stat?.todayJobs ?? 0,
      status,
    };
  });

  return (
    <div className="animate-fadeIn space-y-3.5">
      <div className={cn('grid gap-2.5', serviceCards.length === 1 ? 'grid-cols-1' : serviceCards.length === 2 ? 'grid-cols-2' : 'grid-cols-3')}>
        {serviceCards.map((svc) => (
          <div
            key={svc.id}
            className={cn(
              'flex items-center gap-2.5 rounded-lg border border-huma-bdr bg-huma-bg2 px-3.5 py-2.5 transition hover:border-huma-acc',
              svc.status === 'ok' && 'border-l-[3px] border-l-huma-ok',
              svc.status === 'warn' && 'border-l-[3px] border-l-huma-warn',
              svc.status === 'err' && 'border-l-[3px] border-l-huma-err'
            )}
          >
            <span className="text-lg">{svc.icon}</span>
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-bold text-huma-t">{svc.name}</div>
              <div className={cn('truncate font-mono text-[9.5px] text-huma-t3', svc.status === 'err' && 'text-huma-err')}>
                {svc.detail}
              </div>
            </div>
            <div className="flex flex-col items-end gap-0.5">
              <div className={cn('font-mono text-lg font-bold', svc.status === 'err' && 'text-huma-err')}>
                {svc.jobs}
              </div>
              <div className="text-[8.5px] text-huma-t3">
                {svc.status === 'err' ? '오류 발생' : '오늘 발행'}
              </div>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                className="mt-0.5"
                onClick={() => api.stopAll().catch(() => {})}
              >
                ■ 정지
              </Button>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-4 gap-2.5">
        <div className="stat-card">
          <div className="stat-label">오늘 총 발행</div>
          <div className="stat-value">{stats.todayCompleted}</div>
          <div className="text-[10px] text-huma-ok">실시간 집계</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">큐 대기</div>
          <div className="stat-value">{stats.pendingJobs}</div>
          <div className="text-[10px] text-huma-t3">{stats.paused ? '일시정지' : '활성'}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">오류</div>
          <div className="stat-value text-huma-err">{stats.errors}</div>
          <div className="text-[10px] text-huma-err">24h 기준</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">활성 계정</div>
          <div className="stat-value">
            {stats.activeAccounts}
          </div>
          <div className="text-[10px] text-huma-t3">{stats.healthy ? '정상' : '중지됨'}</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        <div className="panel">
          <div className="panel-title">
            7일 발행수 추이
            <span className="text-[9px] text-huma-acc">오늘 기준</span>
          </div>
          <div className="h-24">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chart.length ? chart : [{ day: '-', value: 0 }]} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <XAxis dataKey="day" tick={{ fill: 'var(--t2)', fontSize: 10, fontFamily: 'monospace' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: 'var(--t3)', fontSize: 9, fontFamily: 'monospace' }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{
                    background: 'var(--bg2)',
                    border: '1px solid var(--bdr)',
                    borderRadius: 8,
                    fontSize: 11,
                  }}
                />
                <Bar dataKey="value" fill="var(--acc)" radius={[3, 3, 0, 0]} opacity={0.85} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="panel">
          <div className="panel-title">워크스페이스 현황</div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>서비스</TableHead>
                <TableHead>오늘</TableHead>
                <TableHead>대기</TableHead>
                <TableHead>오류</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {accessible.map((ws) => {
                const stat = serviceStats.find((s) => s.workspace === ws.id);
                return (
                  <TableRow key={ws.id}>
                    <TableCell>{ws.label}</TableCell>
                    <TableCell className="font-mono">{stat?.todayJobs ?? 0}</TableCell>
                    <TableCell className="font-mono">{stat?.pending ?? 0}</TableCell>
                    <TableCell className={cn('font-mono', (stat?.errors ?? 0) > 0 && 'text-huma-err')}>
                      {stat?.errors ?? 0}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </div>

      <div className="panel">
        <div className="panel-title">최근 발행</div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>제목</TableHead>
              <TableHead>워크스페이스</TableHead>
              <TableHead>상태</TableHead>
              <TableHead>URL</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {recent.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-huma-t3">최근 발행 내역 없음</TableCell>
              </TableRow>
            ) : (
              recent.map((post, i) => (
                <TableRow key={`${post.title}-${i}`}>
                  <TableCell>{post.title}</TableCell>
                  <TableCell>{WORKSPACES.find((w) => w.id === post.workspace)?.short ?? post.workspace}</TableCell>
                  <TableCell>
                    <span className={post.status === 'completed' ? 'tag-ok' : 'tag-warn'}>
                      {post.status === 'completed' ? '완료' : post.status}
                    </span>
                  </TableCell>
                  <TableCell>
                    {post.result_url ? (
                      <a href={post.result_url} target="_blank" rel="noreferrer" className="font-mono text-[10px] text-huma-acc hover:underline">
                        {post.result_url.slice(0, 32)}↗
                      </a>
                    ) : (
                      <span className="text-huma-t3">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="panel">
        <div className="panel-title">실시간 로그</div>
        <LogViewer />
      </div>
    </div>
  );
}
