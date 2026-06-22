'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { EmptyPanel } from '@/components/ui/empty-panel';
import { useWorkspace } from '@/components/dashboard/workspace-context';
import { MGrid, MPanel, MStat, MTable, MTag } from '@/components/mockup/primitives';
import { useRegisterPageAction } from '@/components/dashboard/page-action-context';
import { useShellViewActive } from '@/components/dashboard/shell-view-active';
import { SEO_WORKSPACE_URL } from '@/lib/seo-mock-data';
import { dispatchQueuePrefill } from '@/lib/queue-prefill';
import type { Workspace } from '@huma/shared';

type SeoData = Awaited<ReturnType<typeof api.seoKeywords>>;

export function SeoKeywordsView() {
  const { workspace } = useWorkspace();
  const router = useRouter();
  const [data, setData] = useState<SeoData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const dataRef = useRef<SeoData | null>(null);
  dataRef.current = data;

  const load = useCallback(() => {
    if (!dataRef.current) setLoading(true);
    setError(null);
    api
      .seoKeywords(workspace)
      .then(setData)
      .catch((e: Error) => {
        setData(null);
        setError(e.message);
      })
      .finally(() => setLoading(false));
  }, [workspace]);

  useEffect(() => {
    load();
  }, [load]);

  useRegisterPageAction('refreshSeo', async () => {
    await api.crawlSeo(workspace);
    load();
  });

  const addKwToQueue = (kw: string) => {
    dispatchQueuePrefill({
      title: `${kw} — 완전 가이드`,
      source_url: SEO_WORKSPACE_URL[workspace as Workspace] ?? SEO_WORKSPACE_URL.yeonun,
    });
    router.push('/queue');
  };

  if (loading && !data) {
    return <EmptyPanel message="SEO 키워드 데이터 로딩 중…" />;
  }

  if (error && !data) {
    return <EmptyPanel message={`SEO API 오류: ${error}`} />;
  }

  const d = data!;

  return (
    <div className="animate-fadeIn">
      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-huma-bdr bg-huma-bg2 px-3 py-2 text-[12px] text-huma-t2">
        <span>
          HUMA 블로그 포스팅 생성 시 이 키워드 풀을 참조합니다.{' '}
          <strong className="text-huma-acc">키워드 태그 클릭 → 큐 추가 모달 자동 입력</strong>
        </span>
        <span className="ml-auto whitespace-nowrap rounded border border-huma-bdr bg-[var(--glow)] px-2 py-0.5 font-mono text-[10.5px] text-huma-acc">
          {d.badge}
        </span>
        <span className="w-full font-mono text-[10px] text-huma-t3">
          소스: {d.source === 'search_console' ? 'Google Search Console' : 'huma_jobs 집계'}
          {!d.configured && ` · GSC: ${(d.missingEnv ?? []).join(', ')}`}
        </span>
      </div>

      <MGrid cols={2}>
        <MPanel title="검색 순위 추적">
          {d.ranks.length === 0 ? (
            <EmptyPanel message="순위 없음 — ↻ SEO 갱신" />
          ) : (
            <div className="space-y-2">
              {d.ranks.map((r) => (
                <div key={r.word} className="flex items-center gap-2 border-b border-huma-bdr2 py-2 last:border-0">
                  <span className="w-10 font-mono text-[12px] font-bold text-huma-acc">{r.rank}</span>
                  <span className="flex-1 text-[14px] text-huma-t">{r.word}</span>
                  <span className="font-mono text-[11.5px] text-huma-t3">{r.vol}</span>
                  <span
                    className={`w-10 text-right font-mono text-[12px] ${r.ok === true ? 'text-huma-ok' : r.ok === false ? 'text-huma-err' : 'text-huma-t3'}`}
                  >
                    {r.chg}
                  </span>
                </div>
              ))}
            </div>
          )}
        </MPanel>

        <MPanel title="키워드 풀">
          {d.pool.length === 0 ? (
            <EmptyPanel message="키워드 없음 — ↻ SEO 갱신" />
          ) : (
            <div className="flex flex-wrap gap-1">
              {d.pool.map((kw) => (
                <button key={kw} type="button" className="m-kw-tag" title="이 키워드로 큐 추가" onClick={() => addKwToQueue(kw)}>
                  {kw}
                </button>
              ))}
            </div>
          )}
        </MPanel>
      </MGrid>

      <MPanel title="콘텐츠 ↔ 키워드 연결 맵">
        <p className="mb-3 text-[11.5px] leading-relaxed text-huma-t3">
          <strong className="text-huma-t2">상태</strong>는 주력 키워드별 누적 발행수 기준입니다 —{' '}
          <MTag tone="ok">최상</MTag> 10건 이상 · <MTag tone="ok">양호</MTag> 5~9건 ·{' '}
          <MTag tone="warn">보강필요</MTag> 2~4건 · <MTag tone="err">부족</MTag> 0~1건
        </p>
        {d.table.length === 0 ? (
          <EmptyPanel message="발행 콘텐츠 없음" />
        ) : (
          <MTable
            head={['상품·콘텐츠 ID', '주력 키워드', '발행수', '→ SEO 반영', '상태']}
            rows={d.table.map((r) => [
              <span key="id" className="font-mono text-[12px]">{r.id}</span>,
              r.kw,
              <span key="c" className="font-mono">{r.cnt}</span>,
              <span key="ref" className="text-[11.5px] text-huma-t3">{r.reflect}</span>,
              <MTag key="st" tone={r.tone}>{r.st}</MTag>,
            ])}
          />
        )}
      </MPanel>
    </div>
  );
}

export function AdsenseView() {
  const [stats, setStats] = useState<Awaited<ReturnType<typeof api.adsenseStats>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const statsRef = useRef<Awaited<ReturnType<typeof api.adsenseStats>> | null>(null);
  statsRef.current = stats;

  const load = useCallback(() => {
    if (!statsRef.current) setLoading(true);
    setError(null);
    // /adsense는 퀴즈오아시스 전용 — workspace 컨텍스트 전환 race 방지
    api.adsenseStats('quizoasis')
      .then(setStats)
      .catch((e: Error) => {
        setStats(null);
        setError(e.message);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);
  useRegisterPageAction('refreshAdsense', load);

  const fmtUsd = (n: number) => `$${n.toFixed(2)}`;
  const fmtNum = (n: number) => n.toLocaleString('en-US');
  const fmtPct = (n: number) => `${(n * 100).toFixed(2)}%`;
  const fmtCompare = (change: number, changePct: number) => {
    const up = change >= 0;
    const arrow = up ? '▲' : '▼';
    return `이전 7일 대비 ${arrow}${fmtNum(Math.abs(change))} (${arrow}${Math.abs(changePct).toFixed(1)}%)`;
  };
  const fmtCtrCompare = (changePp: number, changePct: number) => {
    const up = changePp >= 0;
    const arrow = up ? '▲' : '▼';
    return `이전 7일 대비 ${arrow}${Math.abs(changePp).toFixed(2)}pp (${arrow}${Math.abs(changePct).toFixed(1)}%)`;
  };
  const fmtUsdCompare = (change: number, changePct: number) => {
    const up = change >= 0;
    const arrow = up ? '▲' : '▼';
    return `이전 7일 대비 ${arrow}${fmtUsd(Math.abs(change))} (${arrow}${Math.abs(changePct).toFixed(1)}%)`;
  };

  if (loading && !stats) {
    return (
      <div className="animate-fadeIn">
        <MPanel title="애드센스 수익">
          <EmptyPanel message="AdSense 데이터 불러오는 중…" />
        </MPanel>
      </div>
    );
  }

  if (error) {
    const isAuthError = error.includes('토큰') || error.includes('인증');
    const isGoogleError =
      error.includes('refresh token') ||
      error.includes('Google') ||
      error.includes('AdSense Management') ||
      error.includes('invalid_grant');
    return (
      <div className="animate-fadeIn">
        <MPanel title="애드센스 수익">
          <EmptyPanel
            message={
              isAuthError
                ? `${error} — 로그아웃 후 다시 로그인하세요.`
                : isGoogleError
                  ? `${error}\n\n→ i7 apps/server/.env의 ADSENSE_REFRESH_TOKEN 재발급 또는 Google Cloud OAuth scope 확인`
                  : error
            }
          />
        </MPanel>
      </div>
    );
  }

  if (!stats?.configured) {
    const missing = stats?.missingEnv?.length
      ? `\n누락: ${stats.missingEnv.join(', ')}`
      : '';
    const rebuildHint = stats?.missingEnv === undefined
      ? '\n\n→ i7에서 git pull → npm run build --workspace=@huma/server → 서버 재시작 후 tail /tmp/huma-server.log | grep AdSense 로 configured 확인'
      : '';
    return (
      <div className="animate-fadeIn">
        <MPanel title="애드센스 수익">
          <EmptyPanel message={`AdSense 환경변수를 i7 apps/server/.env에 설정 후 서버를 재시작하세요.${missing}\n\n※ 웹(Vercel) .env가 아닌 i7 서버 .env입니다.${rebuildHint}`} />
        </MPanel>
      </div>
    );
  }

  return (
    <div className="animate-fadeIn">
      <MPanel title="미지급 + 이번달 합계">
        <div className="font-mono text-[39px] font-bold text-huma-acc">{fmtUsd(stats.combinedTotal)}</div>
        <div className="mt-3 space-y-1 text-xs text-huma-t2">
          <div className="flex justify-between">
            <span>미지급 잔고</span>
            <span className="font-mono">{stats.unpaidBalanceFormatted || fmtUsd(stats.unpaidBalance)}</span>
          </div>
          <div className="flex justify-between">
            <span>이번달 수익</span>
            <span className="font-mono">{fmtUsd(stats.monthEarnings)}</span>
          </div>
          <div className="flex justify-between border-t border-huma-bdr pt-1 font-medium text-huma-t">
            <span>합계</span>
            <span className="font-mono">{fmtUsd(stats.combinedTotal)}</span>
          </div>
        </div>
      </MPanel>
      <MGrid cols={3}>
        <MStat label="오늘 수익" value={fmtUsd(stats.todayEarnings)} sub="TODAY" />
        <MStat label="어제 수익" value={fmtUsd(stats.yesterdayEarnings)} sub="YESTERDAY" />
        <MStat
          label="CPC"
          value={fmtUsd(stats.last7Days.cpc.current)}
          sub={fmtUsdCompare(stats.last7Days.cpc.change, stats.last7Days.cpc.changePct)}
        />
      </MGrid>
      <MGrid cols={3}>
        <MStat
          label="클릭수"
          value={fmtNum(stats.last7Days.clicks.current)}
          sub={fmtCompare(stats.last7Days.clicks.change, stats.last7Days.clicks.changePct)}
        />
        <MStat
          label="CTR"
          value={fmtPct(stats.last7Days.ctr.current)}
          sub={fmtCtrCompare(stats.last7Days.ctr.changePp, stats.last7Days.ctr.changePct)}
        />
        <MStat
          label="RPM"
          value={fmtUsd(stats.last7Days.rpm.current)}
          sub={fmtUsdCompare(stats.last7Days.rpm.change, stats.last7Days.rpm.changePct)}
        />
      </MGrid>
      <MGrid cols={2}>
        <MStat
          label="최근 7일 PV"
          value={fmtNum(stats.last7Days.pageViews.current)}
          sub={fmtCompare(stats.last7Days.pageViews.change, stats.last7Days.pageViews.changePct)}
        />
        <MStat
          label="최근 7일 노출"
          value={fmtNum(stats.last7Days.impressions.current)}
          sub={fmtCompare(stats.last7Days.impressions.change, stats.last7Days.impressions.changePct)}
        />
      </MGrid>
      <MGrid cols={2}>
        <MPanel title="이번달 수익">
          <div className="font-mono text-[39px] font-bold text-huma-t">{fmtUsd(stats.monthEarnings)}</div>
          <div className="mt-4 space-y-2 text-xs text-huma-t2">
            <div className="flex justify-between"><span>오늘</span><span className="font-mono">{fmtUsd(stats.todayEarnings)}</span></div>
            <div className="flex justify-between"><span>어제</span><span className="font-mono">{fmtUsd(stats.yesterdayEarnings)}</span></div>
            <div className="flex justify-between"><span>미지급 잔고</span><span className="font-mono">{stats.unpaidBalanceFormatted || fmtUsd(stats.unpaidBalance)}</span></div>
            <div className="flex justify-between border-t border-huma-bdr pt-1 font-medium text-huma-t">
              <span>미지급 + 이번달</span>
              <span className="font-mono">{fmtUsd(stats.combinedTotal)}</span>
            </div>
            <div className="flex justify-between"><span>PV</span><span className="font-mono">{fmtNum(stats.monthPageViews)}</span></div>
          </div>
        </MPanel>
        <MPanel title="월별 추이">
          {stats.monthlyTrend.length === 0 ? (
            <EmptyPanel message="월별 데이터 없음" />
          ) : (
            <MTable
              head={['월', '수익', 'PV', 'RPM']}
              rows={stats.monthlyTrend.map((row) => [
                row.month,
                fmtUsd(row.earnings),
                fmtNum(row.pageViews),
                fmtUsd(row.rpm),
              ])}
            />
          )}
        </MPanel>
      </MGrid>
    </div>
  );
}

export function ScenarioView() {
  useRegisterPageAction('openScenarioForm', () => {});
  return (
    <div className="animate-fadeIn">
      <MPanel title="영상 시나리오">
        <EmptyPanel message="등록된 시나리오가 없습니다." />
      </MPanel>
    </div>
  );
}

export function SocialView() {
  useRegisterPageAction('refreshSocial', async () => {});
  return (
    <div className="animate-fadeIn">
      <MPanel title="소셜 분석·DM 자동화">
        <EmptyPanel message="소셜 분석 데이터가 없습니다. 플랫폼 API 연동 후 표시됩니다." />
      </MPanel>
    </div>
  );
}
