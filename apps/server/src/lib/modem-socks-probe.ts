import { execFile } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { promisify } from 'node:util';

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

/** LTE 동글 SOCKS — 8초는 간헐 타임아웃(exit 28) 빈번 */
export const MODEM_SOCKS_PROBE_TIMEOUT_MS = 18_000;

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
async function probeModemSocksOnce(
  proxyPort: number,
  timeoutMs: number,
): Promise<{ ok: boolean; ms: number | null }> {
  const start = Date.now();
  const maxSec = Math.max(5, Math.ceil(timeoutMs / 1000));
  const connectSec = Math.min(12, Math.max(5, Math.floor(timeoutMs / 2000)));
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
        'https://www.naver.com',
      ],
      {
        timeout: timeoutMs + 5000,
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

export async function probeModemSocks(
  proxyPort: number,
  timeoutMs = MODEM_SOCKS_PROBE_TIMEOUT_MS,
): Promise<{ ok: boolean; ms: number | null }> {
  const hardMs = timeoutMs + 1500;
  const once = () =>
    Promise.race([
      probeModemSocksOnce(proxyPort, timeoutMs),
      new Promise<{ ok: boolean; ms: number | null }>((resolve) =>
        setTimeout(() => resolve(PROBE_FAIL), hardMs),
      ),
    ]);

  const first = await once();
  if (first.ok) return first;

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
