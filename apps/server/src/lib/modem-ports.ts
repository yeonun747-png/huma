/** v3.22 §7-13 — LTE 동글 슬롯·포트 매핑 */
export const POSTING_PROXY_PORTS = [10001, 10002, 10003, 10004] as const;
export const CRANK_PROXY_PORTS = [10005, 10006, 10007, 10008, 10009, 10010] as const;

export const MODEM_LOCK_TTL_SEC = 300;

export function proxyPortToSlot(proxyPort: number): number {
  return proxyPort - 10000;
}

export function isCrankProxyPort(port: number): boolean {
  return (CRANK_PROXY_PORTS as readonly number[]).includes(port);
}

export function isPostingProxyPort(port: number): boolean {
  return (POSTING_PROXY_PORTS as readonly number[]).includes(port);
}
