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
  | 'startCrank'
  | 'scanCafeViral'
  | 'openModemForm'
  | 'refreshSeo'
  | 'refreshAdsense'
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

/** 목업 기준: 탑바 Primary 버튼 없음 — 패널/모달에서만 액션 */
const NO_ACTION = { action: '—', actionType: 'none' as const };

export const PAGE_META: Record<string, PageMeta> = {
  '/dashboard': { title: '대시보드', showPeriod: true, ...NO_ACTION },
  '/queue': { title: '큐 관리', ...NO_ACTION },
  '/calendar': { title: '스케줄 캘린더', ...NO_ACTION },
  '/monitor': { title: '발행 모니터', ...NO_ACTION },
  '/oplog': { title: 'Operation Log', ...NO_ACTION },
  '/accounts': { title: '계정 관리', contentClass: 'accounts-page-main', ...NO_ACTION },
  '/video-pipeline': { title: '영상 파이프라인', ...NO_ACTION },
  '/watcher': { title: 'Layer4 Watcher', ...NO_ACTION },
  '/human-engine': { title: '휴먼 엔진 설정', contentClass: 'px-[18px] py-4', ...NO_ACTION },
  '/bgm-library': { title: '오디오 정책', ...NO_ACTION },
  '/crank': { title: 'C-Rank 소통 관리', ...NO_ACTION },
  '/cafe-viral': { title: '카페 관리', ...NO_ACTION },
  '/modems': { title: '프록시 관리', ...NO_ACTION },
  '/settings': { title: '환경 설정', ...NO_ACTION },
  '/seo-keywords': { title: 'SEO 키워드', ...NO_ACTION },
  '/adsense': { title: '애드센스 수익', ...NO_ACTION },
};

export function getPageMeta(pathname: string): PageMeta {
  return PAGE_META[pathname] ?? { title: 'HUMA', ...NO_ACTION };
}
