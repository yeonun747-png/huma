import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** 프록시 관리 `/api/modems?probe=1` 과 동일 SOCKS 검사 시간 */
export const MODEM_SOCKS_PROBE_TIMEOUT_MS = 8000;

const PROBE_FAIL = { ok: false, ms: null } as const;

/** check-socks-proxy.sh 와 동일 — curl --socks5-hostname (axios는 SOCKS5 미지원) */
async function probeModemSocksOnce(
  proxyPort: number,
  timeoutMs: number,
): Promise<{ ok: boolean; ms: number | null }> {
  const start = Date.now();
  const maxSec = Math.max(1, Math.ceil(timeoutMs / 1000));
  try {
    const { stdout } = await execFileAsync(
      'curl',
      [
        '-s',
        '-o',
        process.platform === 'win32' ? 'NUL' : '/dev/null',
        '-w',
        '%{http_code}',
        '--max-time',
        String(maxSec),
        '--socks5-hostname',
        `127.0.0.1:${proxyPort}`,
        'https://www.naver.com',
      ],
      { timeout: timeoutMs + 2000 },
    );
    const code = parseInt(String(stdout).trim(), 10);
    if (code >= 200 && code < 400) {
      return { ok: true, ms: Date.now() - start };
    }
    return PROBE_FAIL;
  } catch {
    return PROBE_FAIL;
  }
}

export async function probeModemSocks(
  proxyPort: number,
  timeoutMs = MODEM_SOCKS_PROBE_TIMEOUT_MS,
): Promise<{ ok: boolean; ms: number | null }> {
  const hardMs = timeoutMs + 1500;
  return Promise.race([
    probeModemSocksOnce(proxyPort, timeoutMs),
    new Promise<{ ok: boolean; ms: number | null }>((resolve) =>
      setTimeout(() => resolve(PROBE_FAIL), hardMs),
    ),
  ]);
}
