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

/** check-socks-proxy.sh · restore 5단계 와 동일 */
export const MODEM_SOCKS_PROBE_CONNECT_TIMEOUT_SEC = 15;
export const MODEM_SOCKS_PROBE_MAX_TIME_SEC = 45;

/** LTE 동글 SOCKS naver GET — i7 SSH 기준 30초+ 성공도 흔함 */
export const MODEM_SOCKS_PROBE_TIMEOUT_MS = (() => {
  const raw = Number(process.env.HUMA_MODEM_SOCKS_PROBE_TIMEOUT_MS);
  return Number.isFinite(raw) && raw >= 10_000 ? raw : MODEM_SOCKS_PROBE_MAX_TIME_SEC * 1000;
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

/** env 지정 시 그 URL로 GET probe */
export const MODEM_SOCKS_PROBE_URL = process.env.HUMA_MODEM_SOCKS_PROBE_URL?.trim() || NAVER_HOME_PROBE;

/** check-socks-proxy.sh 성공 HTTP 코드 */
export function isModemSocksNaverSuccessCode(code: number): boolean {
  return code === 200 || code === 301 || code === 302;
}

/** curl -w '%{http_code}:%{time_total}' 파싱 */
export function parseModemSocksCurlResult(stdout: string): { ok: boolean; ms: number | null } {
  const raw = String(stdout).trim();
  if (raw.includes(':')) {
    const [codePart, totalPart] = raw.split(':');
    const code = parseInt(codePart ?? '', 10);
    const totalSec = parseFloat(totalPart ?? '');
    if (
      isModemSocksNaverSuccessCode(code) &&
      Number.isFinite(totalSec) &&
      totalSec > 0
    ) {
      return { ok: true, ms: Math.round(totalSec * 1000) };
    }
    return PROBE_FAIL;
  }
  const code = parseInt(raw, 10);
  return isModemSocksNaverSuccessCode(code) ? { ok: true, ms: null } : PROBE_FAIL;
}

/** naver.com GET — restore check-socks-proxy.sh 와 동일 (본문 수신·time_total) */
async function probeModemSocksNaverGet(
  proxyPort: number,
  targetUrl: string,
): Promise<{ ok: boolean; ms: number | null }> {
  const start = Date.now();
  const subprocessTimeoutMs = MODEM_SOCKS_PROBE_TIMEOUT_MS + 8000;
  try {
    const { stdout } = await execFileAsync(
      CURL_BIN,
      [
        '-4',
        '-s',
        '-o',
        process.platform === 'win32' ? 'NUL' : '/dev/null',
        '-w',
        '%{http_code}:%{time_total}',
        '--connect-timeout',
        String(MODEM_SOCKS_PROBE_CONNECT_TIMEOUT_SEC),
        '--max-time',
        String(MODEM_SOCKS_PROBE_MAX_TIME_SEC),
        '--socks5-hostname',
        `127.0.0.1:${proxyPort}`,
        targetUrl,
      ],
      {
        timeout: subprocessTimeoutMs,
        env: curlSubprocessEnv(),
      },
    );
    const parsed = parseModemSocksCurlResult(stdout);
    if (parsed.ok) {
      return { ok: true, ms: parsed.ms ?? Date.now() - start };
    }
    return PROBE_FAIL;
  } catch {
    return PROBE_FAIL;
  }
}

async function probeModemSocksMeasured(
  proxyPort: number,
): Promise<{ ok: boolean; ms: number | null }> {
  const customUrl = process.env.HUMA_MODEM_SOCKS_PROBE_URL?.trim();
  return probeModemSocksNaverGet(proxyPort, customUrl || NAVER_HOME_PROBE);
}

export async function probeModemSocks(
  proxyPort: number,
  timeoutMs = MODEM_SOCKS_PROBE_TIMEOUT_MS,
): Promise<{ ok: boolean; ms: number | null }> {
  const hardMs = timeoutMs + 3000;
  const once = () =>
    Promise.race([
      probeModemSocksMeasured(proxyPort),
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
