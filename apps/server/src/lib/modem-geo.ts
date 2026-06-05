import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { CURL_BIN, curlSubprocessEnv } from './modem-socks-probe.js';

const execFileAsync = promisify(execFile);

const GEO_LOOKUP_TIMEOUT_MS = 10_000;
const PUBLIC_IP_SOCKS_TIMEOUT_MS = 30_000;

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

const KO_SUFFIX_STRIP = /(특별시|광역시|특별자치도|특별자치시|도)$/;

function shortKoreanPlace(name: string): string {
  const t = name.trim();
  if (!t) return t;
  if (KO_REGION[t]) return KO_REGION[t];
  if (/[가-힣]/.test(t)) {
    const base = t.replace(KO_SUFFIX_STRIP, '').trim();
    return base || t;
  }
  return t;
}

export function formatKoreaRegion(
  city?: string | null,
  regionName?: string | null,
  country?: string | null,
): string | null {
  const province = regionName ? shortKoreanPlace(regionName) : null;
  const cityLabel = city ? shortKoreanPlace(city) : null;

  if (province && cityLabel && province !== cityLabel && !cityLabel.startsWith(province)) {
    return `${province} · ${cityLabel}`;
  }
  if (province) return province;
  if (cityLabel) return cityLabel;
  if (country === 'South Korea' || country === 'KR' || country === 'Korea') return '한국';
  return null;
}

async function curlJson(
  url: string,
  timeoutMs: number,
): Promise<Record<string, unknown> | null> {
  const maxSec = Math.max(3, Math.ceil(timeoutMs / 1000));
  try {
    const { stdout } = await execFileAsync(
      CURL_BIN,
      ['-4', '-s', '--connect-timeout', '5', '--max-time', String(maxSec), url],
      { timeout: timeoutMs + 2000, env: curlSubprocessEnv() },
    );
    return JSON.parse(String(stdout).trim()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** SOCKS egress 공인 IP (가벼운 ipify) */
export async function fetchPublicIpViaSocks(
  proxyPort: number,
  timeoutMs = PUBLIC_IP_SOCKS_TIMEOUT_MS,
): Promise<string | null> {
  const maxSec = Math.max(5, Math.ceil(timeoutMs / 1000));
  const connectSec = Math.min(15, Math.max(8, Math.floor(timeoutMs / 3000)));
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
        'https://api.ipify.org',
      ],
      { timeout: timeoutMs + 3000, env: curlSubprocessEnv() },
    );
    const ip = String(stdout).trim();
    return /^\d{1,3}(\.\d{1,3}){3}$/.test(ip) ? ip : null;
  } catch {
    return null;
  }
}

/** 공인 IP 기준 지역 (i7 LAN 직접 조회 — 표시 IP와 동일 소스) */
export async function lookupGeoByPublicIp(
  publicIp: string,
  timeoutMs = GEO_LOOKUP_TIMEOUT_MS,
): Promise<string | null> {
  const ip = publicIp.trim();
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return null;

  const ipApi = await curlJson(
    `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,city,regionName,country&lang=ko`,
    timeoutMs,
  );
  if (ipApi?.status === 'success') {
    const region = formatKoreaRegion(
      String(ipApi.city ?? ''),
      String(ipApi.regionName ?? ''),
      String(ipApi.country ?? ''),
    );
    if (region) return region;
  }

  const ipWho = await curlJson(`https://ipwho.is/${encodeURIComponent(ip)}`, timeoutMs);
  if (ipWho?.success === true) {
    return formatKoreaRegion(
      String(ipWho.city ?? ''),
      String(ipWho.region ?? ''),
      String(ipWho.country_code ?? ipWho.country ?? ''),
    );
  }

  return null;
}

/** SOCKS 공인 IP → IP 기준 Geo lookup */
export async function fetchModemPublicGeo(
  proxyPort: number,
): Promise<{ public_ip: string | null; geo_region: string | null }> {
  const publicIp = await fetchPublicIpViaSocks(proxyPort);
  if (!publicIp) {
    return { public_ip: null, geo_region: null };
  }
  const geoRegion = await lookupGeoByPublicIp(publicIp);
  return { public_ip: publicIp, geo_region: geoRegion };
}
