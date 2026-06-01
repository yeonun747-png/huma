import { execFile } from 'child_process';
import { createConnection } from 'net';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const SOCKS_CHECK_MSG =
  '3proxy SOCKS5 미동작 — i7에서: sudo bash ~/huma/apps/server/scripts/check-socks-proxy.sh';

function assertPortListening(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port }, () => {
      socket.destroy();
      resolve();
    });
    socket.setTimeout(3000);
    socket.on('timeout', () => {
      socket.destroy();
      reject(new Error(`SOCKS5 :${port} 포트 미리슨. ${SOCKS_CHECK_MSG}`));
    });
    socket.on('error', (err) => {
      reject(new Error(`SOCKS5 :${port} 연결 실패 (${err.message}). ${SOCKS_CHECK_MSG}`));
    });
  });
}

/** curl --socks5-hostname (i7 3proxy와 동일 경로) — axios socks5는 Node에서 미지원 */
async function assertSocksHttpViaCurl(port: number): Promise<void> {
  const { stdout } = await execFileAsync('curl', [
    '-s',
    '-o',
    '/dev/null',
    '-w',
    '%{http_code}',
    '--max-time',
    '12',
    '--socks5-hostname',
    `127.0.0.1:${port}`,
    'https://www.naver.com',
  ]);
  const code = stdout.trim();
  if (code === '200' || code === '301' || code === '302') return;
  throw new Error(`SOCKS5 :${port} HTTP ${code || 'FAIL'}. ${SOCKS_CHECK_MSG}`);
}

/** Playwright 기동 전 SOCKS5 연결 가능 여부 확인 */
export async function assertSocksProxyReady(port: number): Promise<void> {
  await assertPortListening(port);
  try {
    await assertSocksHttpViaCurl(port);
  } catch (err) {
    const message = (err as Error).message;
    if (message.includes(SOCKS_CHECK_MSG)) throw err;
    throw new Error(`SOCKS5 :${port} 터널 실패. ${SOCKS_CHECK_MSG}`);
  }
}
