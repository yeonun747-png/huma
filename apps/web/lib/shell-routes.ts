import type { ComponentType } from 'react';

export type ShellViewLoader = () => Promise<{ default: ComponentType<object> }>;

/** AppShell 클라이언트 라우터 — 사이드바 클릭 시 RSC 대기 없이 즉시 전환 */
export const SHELL_VIEW_LOADERS: Record<string, ShellViewLoader> = {
  '/dashboard': () =>
    import('@/components/dashboard/dashboard-home').then((m) => ({ default: m.DashboardHome })),
  '/queue': () => import('@/components/queue/queue-manager').then((m) => ({ default: m.QueueManager })),
  '/calendar': () => import('@/components/pages/calendar-view').then((m) => ({ default: m.CalendarView })),
  '/monitor': () => import('@/components/pages/monitor-view').then((m) => ({ default: m.MonitorView })),
  '/oplog': () => import('@/components/pages/oplog-view').then((m) => ({ default: m.OplogView })),
  '/accounts': () => import('@/components/pages/accounts-view').then((m) => ({ default: m.AccountsView })),
  '/video-pipeline': () =>
    import('@/components/pages/video-view').then((m) => ({ default: m.VideoPipelineView })),
  '/seo-keywords': () =>
    import('@/components/pages/workspace-views').then((m) => ({ default: m.SeoKeywordsView })),
  '/blog-check': () => import('@/components/pages/blog-check-view').then((m) => ({ default: m.BlogCheckView })),
  '/watcher': () => import('@/components/pages/settings-view').then((m) => ({ default: m.WatcherView })),
  '/human-engine': () =>
    import('@/components/dashboard/human-engine-settings').then((m) => ({ default: m.HumanEngineSettings })),
  '/crank': () => import('@/components/pages/crank-view').then((m) => ({ default: m.CrankView })),
  '/modems': () => import('@/components/pages/modems-view').then((m) => ({ default: m.ModemsView })),
  '/settings': () => import('@/components/pages/settings-view').then((m) => ({ default: m.SettingsView })),
  '/cafe-viral': () => import('@/components/pages/cafe-viral-view').then((m) => ({ default: m.CafeViralView })),
  '/adsense': () => import('@/components/pages/workspace-views').then((m) => ({ default: m.AdsenseView })),
  '/bgm-library': () => import('@/components/pages/bgm-view').then((m) => ({ default: m.BgmLibraryView })),
};

export function isShellRoute(pathname: string): boolean {
  return pathname in SHELL_VIEW_LOADERS;
}

export function prefetchShellViews(): void {
  for (const loader of Object.values(SHELL_VIEW_LOADERS)) {
    void loader();
  }
}
