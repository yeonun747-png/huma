/** v3.24 — 포스팅 5동글(10001~10005) · C-Rank 2동글(10006~10007) · i7 7슬롯 */
export const POSTING_PROXY_PORTS = [10001, 10002, 10003, 10004, 10005] as const;
export const CRANK_PROXY_PORTS = [10006, 10007] as const;

/** posting·일반 crank */
export const MODEM_LOCK_TTL_SEC = 300;
/** 스케줄 crank: 세션 60분 + 전환·워밍업 여유(~15분) */
export const CRANK_SCHEDULED_LOCK_TTL_SEC = 75 * 60;

export function proxyPortToSlot(proxyPort: number): number {
  return proxyPort - 10000;
}

export function isCrankProxyPort(port: number): boolean {
  return (CRANK_PROXY_PORTS as readonly number[]).includes(port);
}

export function isPostingProxyPort(port: number): boolean {
  return (POSTING_PROXY_PORTS as readonly number[]).includes(port);
}
