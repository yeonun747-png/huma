'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useWorkspace } from '@/components/dashboard/workspace-context';
import { EmptyPanel } from '@/components/ui/empty-panel';
import { MGrid, MPanel, MStat, MTable } from '@/components/mockup/primitives';
import { useRegisterPageAction } from '@/components/dashboard/page-action-context';

export function SeoKeywordsView() {
  useRegisterPageAction('refreshSeo', async () => {});
  return (
    <div className="animate-fadeIn">
      <MPanel title="SEO 키워드">
        <EmptyPanel message="키워드 추적 데이터가 없습니다. 연동 후 표시됩니다." />
      </MPanel>
    </div>
  );
}

export function AdsenseView() {
  const { workspace } = useWorkspace();
  const [stats, setStats] = useState<Awaited<ReturnType<typeof api.adsenseStats>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api.adsenseStats(workspace)
      .then(setStats)
      .catch((e: Error) => {
        setStats(null);
        setError(e.message);
      })
      .finally(() => setLoading(false));
  }, [workspace]);

  useEffect(() => { load(); }, [load]);
  useRegisterPageAction('refreshAdsense', load);

  const fmtUsd = (n: number) => `$${n.toFixed(2)}`;
  const fmtNum = (n: number) => n.toLocaleString('en-US');

  if (loading) {
    return (
      <div className="animate-fadeIn">
        <MPanel title="애드센스 수익">
          <EmptyPanel message="AdSense 데이터 불러오는 중…" />
        </MPanel>
      </div>
    );
  }

  if (error) {
    return (
      <div className="animate-fadeIn">
        <MPanel title="애드센스 수익">
          <EmptyPanel message={error} />
        </MPanel>
      </div>
    );
  }

  if (!stats?.configured) {
    return (
      <div className="animate-fadeIn">
        <MPanel title="애드센스 수익">
          <EmptyPanel message="AdSense 환경변수 4개를 i7 apps/server/.env에 설정 후 서버를 재시작하세요." />
        </MPanel>
      </div>
    );
  }

  return (
    <div className="animate-fadeIn">
      <MGrid cols={4}>
        <MStat label="오늘 수익" value={fmtUsd(stats.todayEarnings)} sub="ESTIMATED_EARNINGS" />
        <MStat label="월 누계" value={fmtUsd(stats.monthEarnings)} sub="MONTH_TO_DATE" />
        <MStat label="월 PV" value={fmtNum(stats.monthPageViews)} sub="PAGE_VIEWS" />
        <MStat label="RPM" value={fmtUsd(stats.rpm)} sub="수익/PV×1000" />
      </MGrid>
      <MGrid cols={2}>
        <MPanel title="이번달 수익">
          <div className="font-mono text-[39px] font-bold text-huma-t">{fmtUsd(stats.monthEarnings)}</div>
          <div className="mt-4 space-y-2 text-xs text-huma-t2">
            <div className="flex justify-between"><span>PV</span><span className="font-mono">{fmtNum(stats.monthPageViews)}</span></div>
            <div className="flex justify-between"><span>RPM</span><span className="font-mono">{fmtUsd(stats.rpm)}</span></div>
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

export function LanguagesView() {
  useRegisterPageAction('openLangForm', () => {});
  return (
    <div className="animate-fadeIn">
      <MPanel title="다국어 번역 현황">
        <EmptyPanel message="번역 현황 데이터가 없습니다." />
      </MPanel>
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
