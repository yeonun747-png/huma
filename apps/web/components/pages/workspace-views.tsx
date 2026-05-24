'use client';

import { EmptyPanel } from '@/components/ui/empty-panel';
import { MPanel } from '@/components/mockup/primitives';
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
  useRegisterPageAction('refreshAdsense', async () => {});
  return (
    <div className="animate-fadeIn">
      <MPanel title="애드센스 수익">
        <EmptyPanel message="수익 데이터가 없습니다. AdSense API 연동 후 표시됩니다." />
      </MPanel>
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
