/** 사이드바 큐·발행모니터·Watcher 뱃지 즉시 갱신 */
export const NAV_BADGES_REFRESH = 'huma:nav-badges-refresh';

export function refreshNavBadges(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(NAV_BADGES_REFRESH));
}
