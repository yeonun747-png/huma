/** v3.24 — 포스팅 5동글(10001~10005) · C-Rank 2동글(10006~10007) · i7 7슬롯 */
export const POSTING_PROXY_PORTS = [10001, 10002, 10003, 10004, 10005] as const;
export const CRANK_PROXY_PORTS = [10006, 10007] as const;

/** 기본값(하위호환) — 명시 TTL 없을 때 */
export const MODEM_LOCK_TTL_SEC = 300;
/** posting: 워밍업+타이핑+리뷰+발행이 5분을 넘을 수 있어 세션 길이에 맞춰 여유 확보 */
export const POSTING_LOCK_TTL_SEC = 30 * 60;
/** 비스케줄(ad-hoc) crank: 세션 하드캡 45분보다 길게 — 락 만료 중 이중 점유 방지 */
export const CRANK_ADHOC_LOCK_TTL_SEC = 50 * 60;
/** 스케줄 crank: 세션 60분 + 전환·워밍업·지연 여유 */
export const CRANK_SCHEDULED_LOCK_TTL_SEC = 120 * 60;

export function proxyPortToSlot(proxyPort: number): number {
  return proxyPort - 10000;
}

export function isCrankProxyPort(port: number): boolean {
  return (CRANK_PROXY_PORTS as readonly number[]).includes(port);
}

export function isPostingProxyPort(port: number): boolean {
  return (POSTING_PROXY_PORTS as readonly number[]).includes(port);
}
