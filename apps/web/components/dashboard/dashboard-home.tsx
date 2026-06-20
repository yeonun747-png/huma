'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { getAccessibleWorkspaces } from '@/lib/constants';
import { useAuth } from '@/lib/auth-context';
import { useWorkspace } from '@/components/dashboard/workspace-context';
import { useDashboardPeriod } from '@/components/dashboard/dashboard-period-context';
import { roasBarWidth, type PostRow } from '@/lib/dashboard-mock-data';
import { weekdayColorClass } from '@/lib/format-kst';
import { cn } from '@/lib/constants';
import { MGrid, MPanel, MStat, MTable, MTag, MUrlLink } from '@/components/mockup/primitives';
import type { Workspace } from '@huma/shared';

type DashboardApi = Awaited<ReturnType<typeof api.dashboardStats>>;

type RoasRow = {
  title: string;
  blogUrl: string;
  clicks: number;
};

function normalizeRoasItems(
  items: DashboardApi['roasItems'] | undefined,
): RoasRow[] {
  return (items ?? []).map((item) => {
    const legacy = item as {
      views?: number;
      platform?: string;
      blogUrl?: string;
      clicks?: number;
    };
    return {
      title: item.title?.trim() || '제목 없음',
      blogUrl: legacy.blogUrl?.trim() ?? '',
      clicks: Number.isFinite(legacy.clicks) ? legacy.clicks! : Number(legacy.views) || 0,
    };
  });
}

function tagTone(status: PostRow['status']) {
  if (status === 'done') return 'ok' as const;
  if (status === 'error') return 'err' as const;
  if (status === 'running' || status === 'warn') return 'warn' as const;
  return 'idle' as const;
}

function PostUrlCell({ row }: { row: PostRow }) {
  if (row.urlKind === 'link' && row.url) {
    return <MUrlLink href={row.url}>{row.url.replace(/^https?:\/\//, '').slice(0, 36)} ↗</MUrlLink>;
  }
  if (row.urlKind === 'generating') {
    return <span className="font-mono text-[11.5px] text-huma-t4">생성중...</span>;
  }
  if (row.urlKind === 'watcher') {
    return (
      <Link
        href="/watcher"
        className="rounded border border-huma-err bg-transparent px-1.5 py-0.5 font-mono text-[10.5px] text-huma-err hover:bg-[var(--err-bg)]"
      >
        Layer4 감지 → 확인 ↗
      </Link>
    );
  }
  return <span className="font-mono text-[11px] text-huma-t4">—</span>;
}

function PostsTable({ rows, metaHead }: { rows: PostRow[]; metaHead: string }) {
  if (!rows.length) {
    return <p className="py-4 text-center text-[12px] text-huma-t3">발행 기록이 없습니다.</p>;
  }
  return (
    <MTable
      head={['제목', metaHead, '상태', 'URL']}
      rows={rows.map((r) => [
        r.title,
        r.meta,
        <MTag key="s" tone={tagTone(r.status)}>{r.statusLabel}</MTag>,
        <PostUrlCell key="u" row={r} />,
      ])}
      rowClassName={(i) => (rows[i]?.status === 'error' ? 'm-tbl-err-row' : undefined)}
    />
  );
}

export function DashboardHome() {
  const { admin } = useAuth();
  const { workspace } = useWorkspace();
  const { period } = useDashboardPeriod();
  const accessible = getAccessibleWorkspaces(admin);
  const [stats, setStats] = useState<DashboardApi | null>(null);
  const [quizAdsense, setQuizAdsense] = useState<Awaited<ReturnType<typeof api.adsenseStats>> | null>(null);
  const [quizSeo, setQuizSeo] = useState<Awaited<ReturnType<typeof api.seoKeywords>> | null>(null);
  const [crankKeywords, setCrankKeywords] = useState<string[]>([]);

  const load = useCallback(() => {
    void api.dashboardStats({ period }).then(setStats).catch(() => setStats(null));
    if (workspace === 'quizoasis') {
      void api.adsenseStats('quizoasis').then(setQuizAdsense).catch(() => setQuizAdsense(null));
      void api.seoKeywords('quizoasis').then(setQuizSeo).catch(() => setQuizSeo(null));
    }
    if (workspace === 'yeonun') {
      void api.crankFeed().then((f) => setCrankKeywords(f.keywords)).catch(() => setCrankKeywords([]));
    }
  }, [period, workspace]);

  useEffect(() => {
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [load]);

  const WS_ICONS: Record<Workspace, string> = { yeonun: '🔮', quizoasis: '🧠', panana: '🎬' };

  const serviceCards = accessible.map((ws) => {
    const apiStatus = stats?.serviceStatus?.[ws.id];
    return {
      ...ws,
      mock: apiStatus ?? {
        icon: WS_ICONS[ws.id as Workspace],
        name: ws.label,
        detail: stats === null ? '로딩 중…' : '오늘 활동 없음',
        todayJobs: 0,
        jobsLabel: '오늘 발행',
        status: 'ok' as const,
      },
    };
  });

  const periodStats = stats?.integrated ?? {
    todayPublish: 0,
    todayPublishSub: '—',
    queuePending: 0,
    queueSub: '—',
    errors: 0,
    errorsSub: '—',
    activeAccounts: 0,
    totalAccounts: 0,
    accountSub: '—',
  };
  const chartValues = stats?.chart?.map((c) => c.value) ?? [0, 0, 0, 0, 0, 0, 0];
  const chartMeta = stats?.chart ?? [];
  const labels = chartMeta.map((c) => c.day).length ? chartMeta.map((c) => c.day) : ['—', '—', '—', '—', '—', '—', '—'];
  const chartLabel = stats?.chartLabel ?? '데이터 로딩';
  const chartAverage = stats?.chartAverage ?? 0;

  const maxChart = Math.max(...chartValues, 1);
  const maxValue = Math.max(...chartValues, 0);
  const avgLinePct = maxChart > 0 ? (chartAverage / maxChart) * 100 : 0;
  const roasSource = useMemo(() => normalizeRoasItems(stats?.roasItems), [stats?.roasItems]);
  const roasMeta = stats?.roasMeta;
  const maxRoas = Math.max(...roasSource.map((item) => item.clicks), 1);

  const roasRows = useMemo(
    () =>
      roasSource.map((item) => [
        <span key="t" className="block max-w-[148px] truncate" title={item.title}>
          {item.title}
        </span>,
        item.blogUrl ? (
          <MUrlLink key="b" href={item.blogUrl}>
            {item.blogUrl.replace(/^https?:\/\//, '').slice(0, 28)} ↗
          </MUrlLink>
        ) : (
          <span key="b" className="font-mono text-[11px] text-huma-t4">
            —
          </span>
        ),
        <span key="c" className="font-mono">
          {(item.clicks ?? 0).toLocaleString()}
        </span>,
        <span key="bar" className="m-roas-bar" style={{ width: `${roasBarWidth(item.clicks ?? 0, maxRoas)}px` }} />,
      ]),
    [roasSource, maxRoas],
  );

  const yeonunPosts = (stats?.workspacePosts?.yeonun as PostRow[] | undefined) ?? [];
  const yeonunSocial = stats?.yeonunSocial ?? [];
  const quizPosts = (stats?.workspacePosts?.quizoasis as PostRow[] | undefined) ?? [];
  const pananaPosts = (stats?.workspacePosts?.panana as PostRow[] | undefined) ?? [];

  const quizStats = quizAdsense?.configured
    ? [
        { label: '오늘 수익', value: `$${quizAdsense.todayEarnings.toFixed(1)}`, sub: `어제 $${quizAdsense.yesterdayEarnings.toFixed(1)}`, tone: 'ok' as const },
        { label: '월 누계', value: `$${Math.round(quizAdsense.monthEarnings)}`, sub: `RPM $${quizAdsense.rpm.toFixed(2)}` },
        { label: '일 PV', value: quizAdsense.monthPageViews > 1000 ? `${(quizAdsense.monthPageViews / 30 / 1000).toFixed(1)}K` : String(quizAdsense.monthPageViews), sub: '월 평균' },
        { label: 'RPM', value: `$${quizAdsense.rpm.toFixed(2)}`, sub: `CPC $${quizAdsense.cpc.toFixed(2)}` },
      ]
    : [
        { label: '오늘 수익', value: '—', sub: 'AdSense 미설정' },
        { label: '월 누계', value: '—', sub: '—' },
        { label: '일 PV', value: '—', sub: '—' },
        { label: 'RPM', value: '—', sub: '—' },
      ];

  const pananaStats = stats?.pananaStats
    ? [
        { label: '오늘 발행', value: String(stats.pananaStats.todayPosts), sub: `${stats.pananaStats.activePlatforms}채널` },
        { label: '활성 채널', value: String(stats.pananaStats.activePlatforms), sub: 'platform_accounts' },
        {
          label: '오류 계정',
          value: String(stats.pananaStats.errorAccounts),
          sub: stats.pananaStats.errorAccounts > 0 ? '세션 확인 필요' : '정상',
          tone: stats.pananaStats.errorAccounts > 0 ? ('err' as const) : undefined,
        },
        { label: '숏폼 영상', value: '—', sub: '숏폼 영상 관리 참조' },
      ]
    : [
        { label: '오늘 발행', value: '0', sub: '—' },
        { label: '활성 채널', value: '0', sub: '—' },
        { label: '오류 계정', value: '0', sub: '—' },
        { label: '숏폼 영상', value: '—', sub: '—' },
      ];

  const accountStats = periodStats;
  const quizKeywords = quizSeo?.ranks ?? [];

  return (
    <div className="animate-fadeIn">
      <div className="m-status-bar">
        {serviceCards.map((svc) => {
          const m = svc.mock;
          return (
            <div key={svc.id} className={`m-status-card st-${m.status}`}>
              <span className="text-lg">{m.icon}</span>
              <div className="min-w-0 flex-1">
                <div className="m-st-name">{m.name}</div>
                <div className={`m-st-detail ${m.status === 'err' ? 'text-huma-err' : ''}`}>{m.detail}</div>
              </div>
              <div className="flex flex-col items-end">
                <div className={`m-st-jobs ${m.status === 'err' ? 'err' : ''}`}>{m.todayJobs}</div>
                <div className="m-st-jobs-l">{m.jobsLabel}</div>
                <button
                  type="button"
                  className="m-svc-stop"
                  onClick={() => {
                    const reason = window.prompt(`${m.name} 서비스를 정지합니다.\n정지 이유를 입력하세요:`);
                    if (reason?.trim()) void api.stopAll(reason.trim());
                  }}
                >
                  ■ 정지
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <MGrid cols={4}>
        <MStat label="오늘 총 발행" value={periodStats.todayPublish} sub={periodStats.todayPublishSub} tone="ok" />
        <MStat label="포스팅 대기" value={periodStats.queuePending} sub={periodStats.queueSub} />
        <MStat label="오류" value={periodStats.errors} tone="err" sub={periodStats.errorsSub} />
        <Link href="/accounts" className="block transition hover:opacity-90">
          <MStat
            label="활성 계정"
            value={
              <>
                {accountStats.activeAccounts}
                <span className="text-[13.5px] text-huma-t3">/{accountStats.totalAccounts}</span>
              </>
            }
            sub={accountStats.accountSub}
            tone={accountStats.accountSub.includes('⚠') ? 'err' : undefined}
          />
        </Link>
      </MGrid>

      <MGrid cols={2}>
        <MPanel
          className="m-panel-fill"
          title={
            <>
              <span>7일 발행수 추이</span>
              <span className="ml-auto text-[10.5px] font-normal normal-case tracking-normal text-huma-t3">
                AI 블로그 발행 · {chartLabel}
              </span>
            </>
          }
        >
          <div className="m-bar-chart-wrap">
            <div className="m-bar-chart">
              {chartAverage > 0 && maxChart > 0 ? (
                <div className="m-bar-chart-avg" style={{ bottom: `${Math.max(8, avgLinePct * 0.88 + 8)}%` }}>
                  <span className="m-bar-chart-avg-label">평균 {chartAverage} 발행</span>
                </div>
              ) : null}
              {chartValues.map((value, i) => {
                const isToday = chartMeta[i]?.isToday ?? false;
                const isMax = value > 0 && value === maxValue;
                const barPct = Math.max(value > 0 ? 8 : 0, (value / maxChart) * 100);
                return (
                  <div
                    key={`${labels[i]}-${i}`}
                    className={`m-bar-col${isToday ? ' is-today' : ''}${isMax ? ' is-max' : ''}`}
                  >
                    <div className={`m-bar-val${value === 0 ? ' m-bar-val-zero' : ''}`}>{value}</div>
                    <div className="m-bar-track">
                      <div
                        className="m-bar-fill"
                        style={{ height: `${barPct}%` }}
                        title={`${labels[i]} · ${value}건`}
                      />
                    </div>
                    <div
                      className={cn(
                        'm-bar-label',
                        /^[월화수목금토일]$/.test(labels[i] ?? '') && weekdayColorClass(labels[i]!),
                        isToday && 'm-bar-label-today',
                      )}
                    >
                      {labels[i]}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="m-bar-chart-foot">
              <span>최근 7일 · post_blog (파이프라인)</span>
              <span>
                합계 {chartValues.reduce((s, v) => s + v, 0)} · 최대 {maxValue}
              </span>
            </div>
          </div>
        </MPanel>

        <MPanel
          className="m-panel-fill"
          title={
            <>
              <span>발행 콘텐츠 성과 · 상위 5</span>
              <span className="ml-auto text-[10.5px] font-normal normal-case tracking-normal text-huma-t3">
                GSC · 최근 28일
              </span>
            </>
          }
        >
          {roasMeta && !roasMeta.configured ? (
            <p className="py-4 text-center text-[12px] text-huma-t3">
              Search Console 미설정 ·{' '}
              <Link href="/seo-keywords" className="text-huma-accent hover:underline">
                SEO 키워드
              </Link>
              에서 연동
            </p>
          ) : roasRows.length === 0 ? (
            <p className="py-4 text-center text-[12px] text-huma-t3">최근 28일 발행 기록이 없습니다.</p>
          ) : (
            <MTable head={['제목', '블로그', '유입', '효율']} rows={roasRows} />
          )}
        </MPanel>
      </MGrid>

      {workspace === 'yeonun' && (
        <>
          <MPanel title="오늘 발행 현황">
            <PostsTable rows={yeonunPosts} metaHead="계정명" />
          </MPanel>
          <MPanel title="Bot Social Activity · 연운">
            {yeonunSocial.length === 0 ? (
              <p className="py-4 text-center text-[12px] text-huma-t3">C-Rank 활동 데이터 없음</p>
            ) : (
              yeonunSocial.map((row) => (
                <div key={row.label} className="m-soc-row">
                  <span className="m-soc-l">{row.label}</span>
                  <span className="m-soc-v">
                    {row.current}
                    {row.max != null && <span className="text-[11.5px] text-huma-t3">/{row.max}</span>}
                    {row.max == null && '건'}
                  </span>
                </div>
              ))
            )}
            {crankKeywords.length > 0 && (
              <div className="mt-3 font-mono text-[10.5px] text-huma-t3">
                최근 댓글 키워드: {crankKeywords.join(', ')}
              </div>
            )}
          </MPanel>
        </>
      )}

      {workspace === 'quizoasis' && (
        <>
          <MGrid cols={4}>
            {quizStats.map((s) => (
              <MStat key={s.label} label={s.label} value={s.value} sub={s.sub} tone={s.tone} />
            ))}
          </MGrid>
          <MGrid cols={2}>
            <MPanel title="TOP 키워드">
              {quizKeywords.length === 0 ? (
                <p className="py-4 text-center text-[12px] text-huma-t3">
                  Search Console / SEO API 데이터 없음 — SEO 메뉴에서 갱신
                </p>
              ) : (
                quizKeywords.map((k) => (
                  <div key={k.word} className="flex items-center gap-2 border-b border-huma-bdr2 py-2 last:border-0">
                    <span className="w-10 font-mono text-[12px] font-bold text-huma-acc">{k.rank}</span>
                    <span className="flex-1 text-[14px]">{k.word}</span>
                    <span className="font-mono text-[11.5px] text-huma-t3">{k.vol}</span>
                    <span
                      className={`w-10 text-right font-mono text-[12px] ${k.ok === true ? 'text-huma-ok' : k.ok === false ? 'text-huma-err' : 'text-huma-t3'}`}
                    >
                      {k.chg}
                    </span>
                  </div>
                ))
              )}
            </MPanel>
            <MPanel title="오늘 발행">
              <PostsTable rows={quizPosts} metaHead="언어" />
            </MPanel>
          </MGrid>
        </>
      )}

      {workspace === 'panana' && (
        <>
          <MGrid cols={4}>
            {pananaStats.map((s) => (
              <MStat key={s.label} label={s.label} value={s.value} sub={s.sub} tone={s.tone} />
            ))}
          </MGrid>
          <MPanel title="오늘 발행">
            <PostsTable rows={pananaPosts} metaHead="플랫폼" />
          </MPanel>
        </>
      )}
    </div>
  );
}
