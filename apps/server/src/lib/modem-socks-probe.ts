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

const NAVER_HOME_PROBE = 'https://www.naver.com';
const NAVER_FAVICON_PROBE = 'https://www.naver.com/favicon.ico';

/** env 지정 시 그 URL로 GET probe (check-socks-proxy.sh 수동 검증용) */
export const MODEM_SOCKS_PROBE_URL = process.env.HUMA_MODEM_SOCKS_PROBE_URL?.trim() || NAVER_HOME_PROBE;

function parseCurlProbeResult(stdout: string): { ok: boolean; ms: number | null } {
  const raw = String(stdout).trim();
  if (raw.includes(':')) {
    const [codePart, ttfbPart] = raw.split(':');
    const code = parseInt(codePart ?? '', 10);
    const ttfbSec = parseFloat(ttfbPart ?? '');
    if (code >= 200 && code < 400 && Number.isFinite(ttfbSec) && ttfbSec > 0) {
      return { ok: true, ms: Math.round(ttfbSec * 1000) };
    }
    return PROBE_FAIL;
  }
  const code = parseInt(raw, 10);
  return code >= 200 && code < 400 ? { ok: true, ms: null } : PROBE_FAIL;
}

/** naver.com HEAD TTFB — VNC 첫 바이트에 가깝고 favicon보다 대표적 (본문·JS·이미지는 제외) */
async function probeModemSocksHeadTtfb(
  proxyPort: number,
  timeoutMs: number,
  targetUrl: string,
): Promise<{ ok: boolean; ms: number | null }> {
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
        '-I',
        '-w',
        '%{http_code}:%{time_starttransfer}',
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
    return parseCurlProbeResult(stdout);
  } catch {
    return PROBE_FAIL;
  }
}

async function probeModemSocksOnce(
  proxyPort: number,
  timeoutMs: number,
  targetUrl = NAVER_FAVICON_PROBE,
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
    const parsed = parseCurlProbeResult(stdout);
    if (parsed.ok) {
      return { ok: true, ms: parsed.ms ?? Date.now() - start };
    }
    return PROBE_FAIL;
  } catch {
    return PROBE_FAIL;
  }
}

/** cold SOCKS 직후 첫 naver HEAD도 간헐 2.5초+ — 재측정해 더 낮은 ms 선택 */
const PROBE_WARM_RETRY_MS = 2_500;

async function probeModemSocksMeasured(
  proxyPort: number,
  timeoutMs: number,
): Promise<{ ok: boolean; ms: number | null }> {
  const customUrl = process.env.HUMA_MODEM_SOCKS_PROBE_URL?.trim();
  if (customUrl) {
    return probeModemSocksOnce(proxyPort, timeoutMs, customUrl);
  }

  const head = await probeModemSocksHeadTtfb(proxyPort, timeoutMs, NAVER_HOME_PROBE);
  if (head.ok) return head;

  return probeModemSocksOnce(proxyPort, timeoutMs, NAVER_FAVICON_PROBE);
}

export async function probeModemSocks(
  proxyPort: number,
  timeoutMs = MODEM_SOCKS_PROBE_TIMEOUT_MS,
): Promise<{ ok: boolean; ms: number | null }> {
  const hardMs = timeoutMs + 3000;
  const once = () =>
    Promise.race([
      probeModemSocksMeasured(proxyPort, timeoutMs),
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
