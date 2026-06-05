import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { CURL_BIN, curlSubprocessEnv, MODEM_SOCKS_PROBE_TIMEOUT_MS } from './modem-socks-probe.js';

const execFileAsync = promisify(execFile);

const KO_REGION: Record<string, string> = {
  Seoul: '서울',
  Busan: '부산',
  Incheon: '인천',
  Daegu: '대구',
  Daejeon: '대전',
  Gwangju: '광주',
  Ulsan: '울산',
  Sejong: '세종',
  'Gyeonggi-do': '경기',
  Gyeonggi: '경기',
  'Gangwon-do': '강원',
  Gangwon: '강원',
  'Chungcheongbuk-do': '충북',
  'Chungcheongnam-do': '충남',
  'Jeollabuk-do': '전북',
  'Jeollanam-do': '전남',
  'Gyeongsangbuk-do': '경북',
  'Gyeongsangnam-do': '경남',
  'Jeju-do': '제주',
  Jeju: '제주',
};

export function formatKoreaRegion(
  city?: string | null,
  regionName?: string | null,
  country?: string | null,
): string | null {
  const c = (city ?? '').trim();
  const r = (regionName ?? '').trim();
  if (KO_REGION[c]) return KO_REGION[c];
  if (KO_REGION[r]) return KO_REGION[r];
  if (c && /[가-힣]/.test(c)) return c;
  if (r && /[가-힣]/.test(r)) return r;
  if (c) return c;
  if (r) return r;
  if (country === 'South Korea') return '한국';
  return null;
}

/** SOCKS 경유 공인 IP + 지역 (ip-api.com — exit IP 기준) */
export async function fetchModemPublicGeo(
  proxyPort: number,
  timeoutMs = MODEM_SOCKS_PROBE_TIMEOUT_MS,
): Promise<{ public_ip: string | null; geo_region: string | null }> {
  const maxSec = Math.max(5, Math.ceil(timeoutMs / 1000));
  const connectSec = Math.min(12, Math.max(5, Math.floor(timeoutMs / 2000)));
  try {
    const { stdout } = await execFileAsync(
      CURL_BIN,
      [
        '-4',
        '-s',
        '--connect-timeout',
        String(connectSec),
        '--max-time',
        String(maxSec),
        '--socks5-hostname',
        `127.0.0.1:${proxyPort}`,
        'http://ip-api.com/json/?fields=status,query,city,regionName,country',
      ],
      { timeout: timeoutMs + 5000, env: curlSubprocessEnv() },
    );
    const data = JSON.parse(String(stdout).trim()) as {
      status?: string;
      query?: string;
      city?: string;
      regionName?: string;
      country?: string;
    };
    if (data.status !== 'success' || !data.query) {
      return { public_ip: null, geo_region: null };
    }
    return {
      public_ip: String(data.query),
      geo_region: formatKoreaRegion(data.city, data.regionName, data.country),
    };
  } catch {
    return { public_ip: null, geo_region: null };
  }
}
