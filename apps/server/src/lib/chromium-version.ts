import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

chromium.use(StealthPlugin());

let cachedFullVersion: string | null = null;

/** Playwright 번들 Chromium 전체 버전 (lazy, 프로세스당 1회) */
export async function getBundledChromiumVersion(): Promise<string> {
  if (cachedFullVersion) return cachedFullVersion;
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  try {
    cachedFullVersion = await browser.version();
    return cachedFullVersion;
  } finally {
    await browser.close();
  }
}

/** 저장 UA의 Chrome/x.y.z.w 를 실제 Chromium 버전과 동기화 (DB fingerprint 미변경) */
export function syncUserAgentChromeVersion(storedUa: string, chromiumFullVersion: string): string {
  const major = chromiumFullVersion.split('.')[0] ?? chromiumFullVersion;
  if (/Chrome\/[\d.]+/.test(storedUa)) {
    return storedUa.replace(/Chrome\/[\d.]+/, `Chrome/${chromiumFullVersion}`);
  }
  return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromiumFullVersion} Safari/537.36`;
}

export function majorFromUserAgent(ua: string): string | null {
  const m = ua.match(/Chrome\/(\d+)/);
  return m?.[1] ?? null;
}
