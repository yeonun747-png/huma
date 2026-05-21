export type PageActionType =
  | 'resumeAll'
  | 'saveHuman'
  | 'saveSettings'
  | 'openQueueForm'
  | 'openScheduleForm'
  | 'refreshMonitor'
  | 'downloadOplog'
  | 'openAccountForm'
  | 'startVideoPipeline'
  | 'refreshWatcher'
  | 'openBgmForm'
  | 'startCrank'
  | 'openModemForm'
  | 'refreshSeo'
  | 'refreshAdsense'
  | 'openLangForm'
  | 'openScenarioForm'
  | 'refreshSocial'
  | 'none';

export interface PageMeta {
  title: string;
  action: string;
  actionType: PageActionType;
  showPeriod?: boolean;
  contentClass?: string;
}

export const PAGE_META: Record<string, PageMeta> = {
  '/': { title: '대시보드', action: '▶ 발행 실행', actionType: 'resumeAll', showPeriod: true },
  '/queue': { title: '큐 관리', action: '+ 작업 추가', actionType: 'openQueueForm' },
  '/calendar': { title: '스케줄 캘린더', action: '+ 스케줄 추가', actionType: 'openScheduleForm' },
  '/monitor': { title: '발행 모니터', action: '⟳ 새로고침', actionType: 'refreshMonitor' },
  '/oplog': { title: 'Operation Log', action: '⬇ 다운로드', actionType: 'downloadOplog' },
  '/accounts': { title: '계정 관리', action: '+ 계정 추가', actionType: 'openAccountForm' },
  '/video-pipeline': { title: '영상 파이프라인', action: '▶ 파이프라인', actionType: 'startVideoPipeline' },
  '/watcher': { title: 'Layer4 Watcher', action: '↺ 새로고침', actionType: 'refreshWatcher' },
  '/human-engine': { title: '휴먼 엔진 설정', action: '저장', actionType: 'saveHuman', contentClass: 'px-[18px] py-4' },
  '/bgm-library': { title: 'BGM 라이브러리', action: '+ 음원 추가', actionType: 'openBgmForm' },
  '/crank': { title: 'C-Rank 소통 관리', action: '▶ 소통 실행', actionType: 'startCrank' },
  '/modems': { title: '프록시 관리', action: '+ 프록시 추가', actionType: 'openModemForm' },
  '/settings': { title: '환경 설정', action: '저장', actionType: 'saveSettings' },
  '/seo-keywords': { title: 'SEO 키워드', action: '↺ 분석', actionType: 'refreshSeo' },
  '/adsense': { title: '애드센스 수익', action: '↺ 새로고침', actionType: 'refreshAdsense' },
  '/languages': { title: '다국어 번역 관리', action: '+ 번역 추가', actionType: 'openLangForm' },
  '/scenario': { title: '영상 시나리오', action: '+ 시나리오', actionType: 'openScenarioForm' },
  '/social': { title: '소셜 분석·DM 자동화', action: '↺ 새로고침', actionType: 'refreshSocial' },
};

export function getPageMeta(pathname: string): PageMeta {
  return PAGE_META[pathname] ?? { title: 'HUMA', action: '실행', actionType: 'resumeAll' };
}
