import { execFile } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { promisify } from 'node:util';

import { isPostingDongleProxyPort } from './dongle-route-warm.js';

const execFileAsync = promisify(execFile);

function resolveCurlBin(): string {
  if (process.env.HUMA_CURL_PATH?.trim()) return process.env.HUMA_CURL_PATH.trim();
  if (process.platform === 'win32') return 'curl';
  for (const candidate of ['/usr/bin/curl', '/bin/curl']) {
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      /* next */
    }
  }
  return 'curl';
}

export const CURL_BIN = resolveCurlBin();

/** LTE 동글 SOCKS naver probe — i7 SSH 기준 30초+ 성공도 흔함 */
export const MODEM_SOCKS_PROBE_TIMEOUT_MS = (() => {
  const raw = Number(process.env.HUMA_MODEM_SOCKS_PROBE_TIMEOUT_MS);
  return Number.isFinite(raw) && raw >= 10_000 ? raw : 45_000;
})();

const PROBE_FAIL = { ok: false, ms: null } as const;

export function curlSubprocessEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of [
    'http_proxy',
    'https_proxy',
    'HTTP_PROXY',
    'HTTPS_PROXY',
    'ALL_PROXY',
    'all_proxy',
    'no_proxy',
    'NO_PROXY',
  ]) {
    delete env[key];
  }
  env.PATH = env.PATH ?? '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';
  return env;
}

/** check-socks-proxy.sh 와 동일 — curl --socks5-hostname (axios는 SOCKS5 미지원) */
export const MODEM_SOCKS_PROBE_URL =
  process.env.HUMA_MODEM_SOCKS_PROBE_URL?.trim() || 'https://www.naver.com/favicon.ico';

const SOCKS_IPIFY_WARM_URL = 'https://api.ipify.org';

async function probeModemSocksOnce(
  proxyPort: number,
  timeoutMs: number,
  targetUrl = MODEM_SOCKS_PROBE_URL,
): Promise<{ ok: boolean; ms: number | null }> {
  const start = Date.now();
  const maxSec = Math.max(8, Math.ceil(timeoutMs / 1000));
  const connectSec = Math.min(12, Math.max(5, Math.floor(timeoutMs / 4000)));
  try {
    const { stdout } = await execFileAsync(
      CURL_BIN,
      [
        '-4',
        '-s',
        '-o',
        process.platform === 'win32' ? 'NUL' : '/dev/null',
        '-w',
        '%{http_code}',
        '--connect-timeout',
        String(connectSec),
        '--max-time',
        String(maxSec),
        '--socks5-hostname',
        `127.0.0.1:${proxyPort}`,
        targetUrl,
      ],
      {
        timeout: timeoutMs + 8000,
        env: curlSubprocessEnv(),
      },
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

/** 재부팅·cold SOCKS 직후 첫 naver 요청은 수 초~10초+ — 워밍 후 재측정 */
const PROBE_WARM_RETRY_MS = 2_500;

async function warmPostingDongleSocks(proxyPort: number, timeoutMs: number): Promise<void> {
  if (!isPostingDongleProxyPort(proxyPort)) return;
  await probeModemSocksOnce(proxyPort, Math.min(timeoutMs, 20_000), SOCKS_IPIFY_WARM_URL);
}

export async function probeModemSocks(
  proxyPort: number,
  timeoutMs = MODEM_SOCKS_PROBE_TIMEOUT_MS,
): Promise<{ ok: boolean; ms: number | null }> {
  await warmPostingDongleSocks(proxyPort, timeoutMs);

  const hardMs = timeoutMs + 3000;
  const once = () =>
    Promise.race([
      probeModemSocksOnce(proxyPort, timeoutMs),
      new Promise<{ ok: boolean; ms: number | null }>((resolve) =>
        setTimeout(() => resolve(PROBE_FAIL), hardMs),
      ),
    ]);

  const first = await once();
  if (first.ok) {
    if (first.ms != null && first.ms >= PROBE_WARM_RETRY_MS) {
      await new Promise((r) => setTimeout(r, 350));
      const warmed = await once();
      if (warmed.ok && warmed.ms != null) {
        return warmed.ms <= first.ms ? warmed : first;
      }
    }
    return first;
  }

  await new Promise((r) => setTimeout(r, 400));
  return once();
}

/** 동시 probe 과부하 방지 (7동글 병렬 시 enx·3proxy 간헐 타임아웃) */
export async function probeModemsWithConcurrency<T>(
  items: T[],
  concurrency: number,
  probe: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const idx = next++;
      await probe(items[idx]!);
    }
  });
  await Promise.all(workers);
}
