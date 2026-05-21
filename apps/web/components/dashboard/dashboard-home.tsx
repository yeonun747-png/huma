'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { WORKSPACES, getAccessibleWorkspaces } from '@/lib/constants';
import { useAuth } from '@/lib/auth-context';
import { useWorkspace } from '@/components/dashboard/workspace-context';
import { MGrid, MPanel, MSocRow, MStat, MTable, MTag, MUrlLink } from '@/components/mockup/primitives';

const WS_META: Record<string, { icon: string; name: string }> = {
  yeonun: { icon: '🔮', name: '연운 緣運' },
  quizoasis: { icon: '🧠', name: '퀴즈오아시스' },
  panana: { icon: '🎬', name: '파나나' },
};

const ROAS = [
  ['꿈해몽 가이드', '네이버', '4,821', 90],
  ['MBTI 테스트', 'Google', '3,240', 70],
  ['위로 영상 · 하루', 'TikTok', '12,400', 60],
  ['신년운세 리뷰', '네이버', '2,890', 55],
  ['궁합 체크리스트', '네이버', '1,932', 38],
];

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
    api.dashboardRecent().then(setRecent).catch(() => {});
  }, []);

  const serviceCards = accessible.map((ws) => {
    const stat = serviceStats.find((s) => s.workspace === ws.id);
    const meta = WS_META[ws.id];
    const status = (stat?.errors ?? 0) > 0 ? 'err' : (stat?.pending ?? 0) > 5 ? 'warn' : 'ok';
    return { ...ws, meta, stat, status };
  });

  const maxChart = Math.max(...chart.map((c) => c.value), 1);

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
        <MStat label="오늘 총 발행" value={stats.todayCompleted} sub="▲ 실시간 집계" />
        <MStat label="큐 대기" value={stats.pendingJobs} sub="활성" />
        <MStat label="오류" value={stats.errors} tone="err" sub="Layer4 감지" />
        <MStat label="활성 계정" value={<>{stats.activeAccounts}<span className="text-xs text-huma-t3">/{stats.activeAccounts + 1}</span></>} sub="1계정 오류" />
      </MGrid>

      <MGrid cols={2}>
        <MPanel title={<><span>7일 발행수 추이</span><span className="ml-auto text-[9px] normal-case tracking-normal text-huma-acc">오늘 기준</span></>}>
          <div className="m-bar-chart">
            {(chart.length ? chart : [{ day: '-', value: 0 }]).map((c) => (
              <div key={c.day} className="m-bar-col">
                <div className="m-bar-fill" style={{ height: `${Math.max(4, (c.value / maxChart) * 100)}%` }} title={`${c.value}`} />
                <div className="m-bar-label">{c.day}</div>
              </div>
            ))}
          </div>
        </MPanel>
        <MPanel title="콘텐츠 효율 (ROAS) · 상위 5">
          <MTable
            head={['콘텐츠 유형', '플랫폼', '조회', '효율']}
            rows={ROAS.map(([a, b, c, w]) => [a, b, <span key="m" className="font-mono">{c}</span>, <span key="r" className="m-roas-bar" style={{ width: `${w}px`, display: 'inline-block' }} />])}
          />
        </MPanel>
      </MGrid>

      {workspace === 'yeonun' && (
        <MGrid cols={2}>
          <MPanel title="오늘 발행 현황">
            <MTable
              head={['제목', '캐릭터', '상태', 'URL']}
              rows={recent.filter((r) => r.workspace === 'yeonun').slice(0, 5).map((r) => [
                r.title,
                '—',
                <MTag key="s" tone={r.status === 'completed' ? 'ok' : r.status === 'failed' ? 'err' : 'warn'}>{r.status === 'completed' ? '완료' : r.status}</MTag>,
                r.result_url ? <MUrlLink href={r.result_url}>blog.naver.com/ ↗</MUrlLink> : '—',
              ])}
            />
          </MPanel>
          <MPanel title="Bot Social Activity · 연운">
            <MSocRow label="🤝 오늘 타 블로그 방문" value={<>143<span className="text-[10px] text-huma-t3">/200</span></>} />
            <MSocRow label="❤ 공감 클릭" value={<>89<span className="text-[10px] text-huma-t3">/150</span></>} />
            <MSocRow label="💬 AI 댓글 게시" value={<>31<span className="text-[10px] text-huma-t3">/50</span></>} />
            <MSocRow label="👥 이웃 신청" value={<>12<span className="text-[10px] text-huma-t3">/20</span></>} />
            <MSocRow label="🏛 카페 소통" value="8건" />
          </MPanel>
        </MGrid>
      )}

      {workspace === 'quizoasis' && (
        <>
          <MGrid cols={4}>
            <MStat label="오늘 수익" value="$12.4" sub="▲ $2.1" />
            <MStat label="월 누계" value="$218" sub="목표 54%" />
            <MStat label="일 PV" value="8.2K" sub="▲ 12%" />
            <MStat label="RPM" value="$1.51" sub="↑ $1.34" />
          </MGrid>
          <MGrid cols={2}>
            <MPanel title="TOP 키워드">
              <div className="m-kw-row"><div className="m-kw-rank">#3</div><div className="m-kw-word">MBTI 테스트</div><div className="m-kw-vol">1,240 클릭</div><div className="m-kw-chg ok">▲2</div></div>
              <div className="m-kw-row"><div className="m-kw-rank">#5</div><div className="m-kw-word">성격 유형 테스트</div><div className="m-kw-vol">1,103 클릭</div><div className="m-kw-chg ok">▲3</div></div>
            </MPanel>
            <MPanel title="오늘 발행">
              <MTable head={['테스트명', '언어', '상태', 'URL']} rows={recent.filter((r) => r.workspace === 'quizoasis').slice(0, 3).map((r) => [r.title, '7', <MTag key="s" tone="ok">완료</MTag>, r.result_url ? <MUrlLink href={r.result_url}>IG ↗</MUrlLink> : '—'])} />
            </MPanel>
          </MGrid>
        </>
      )}

      {workspace === 'panana' && (
        <>
          <MGrid cols={4}>
            <MStat label="총 팔로워" value="42K" sub="▲ 1.2K" />
            <MStat label="오늘 발행" value={stats.todayCompleted} sub="4채널" />
            <MStat label="영상 조회" value="28K" sub="오늘" />
            <MStat label="오류 계정" value={stats.errors || 1} tone="err" sub="sora 세션만료" />
          </MGrid>
          <MGrid cols={2}>
            <MPanel title="오늘 발행">
              <MTable head={['캐릭터', '플랫폼', '상태', 'URL']} rows={recent.filter((r) => r.workspace === 'panana').slice(0, 4).map((r) => ['🌸 —', 'TikTok', <MTag key="s" tone={r.status === 'failed' ? 'err' : 'ok'}>{r.status === 'completed' ? '완료' : r.status}</MTag>, r.result_url ? <MUrlLink href={r.result_url}>tiktok ↗</MUrlLink> : '—'])} />
            </MPanel>
            <MPanel title="Bot Social Activity · 파나나">
              <MSocRow label="💬 자동 댓글 반응" value="47건" />
              <MSocRow label="📨 DM 자동 발송" value="12건" />
              <MSocRow label="❤ 좋아요 자동" value="188건" />
            </MPanel>
          </MGrid>
        </>
      )}
    </div>
  );
}
