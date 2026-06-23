/** post_blog·로그인·워밍업 — 동글/프록시 일시 장애 (즉시 failed 대신 재예약) */
export function isPostingConnectionError(message: string): boolean {
  const patterns = [
    'ERR_SOCKS_CONNECTION_FAILED',
    'net::ERR_PROXY',
    'net::ERR_CONNECTION',
    'net::ERR_CONNECTION_RESET',
    'net::ERR_CONNECTION_REFUSED',
    'net::ERR_NETWORK_CHANGED',
    'NS_ERROR_PROXY_CONNECTION_REFUSED',
    'ECONNREFUSED',
    'ETIMEDOUT',
    'ETIMEOUT',
    'socket hang up',
  ];
  return patterns.some((p) => message.includes(p));
}
