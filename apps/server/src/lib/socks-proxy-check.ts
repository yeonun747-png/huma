import axios from 'axios';

const SOCKS_CHECK_MSG =
  '3proxy SOCKS5 미동작 — i7에서: sudo bash ~/huma/apps/server/scripts/check-socks-proxy.sh';

/** Playwright 기동 전 SOCKS5 연결 가능 여부 확인 */
export async function assertSocksProxyReady(port: number): Promise<void> {
  try {
    const res = await axios.get('https://www.naver.com', {
      proxy: { host: '127.0.0.1', port, protocol: 'socks5' },
      timeout: 12_000,
      validateStatus: (s) => s < 500,
      maxRedirects: 0,
    });
    if (res.status >= 200 && res.status < 400) return;
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === 'ECONNREFUSED' || code === 'EPROTO' || code === 'ECONNRESET') {
      throw new Error(`SOCKS5 :${port} 연결 실패 (${code}). ${SOCKS_CHECK_MSG}`);
    }
    if (axios.isAxiosError(err) && err.message.includes('SOCKS')) {
      throw new Error(`SOCKS5 :${port} 연결 실패. ${SOCKS_CHECK_MSG}`);
    }
    // TLS/리다이렉트 등은 프록시 터널 자체는 성공한 것으로 간주
    if (axios.isAxiosError(err) && err.response) return;
  }
  throw new Error(`SOCKS5 :${port} 응답 없음. ${SOCKS_CHECK_MSG}`);
}
