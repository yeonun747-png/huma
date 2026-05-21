import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import type { BrowserContext } from 'playwright';
import { mkdirSync } from 'fs';
import { injectFingerprint, type AccountFingerprint } from './fingerprint.js';
import type { AccountPersona } from './persona.js';
import { getFingerprintConfig } from '../../lib/settings.js';

chromium.use(StealthPlugin());

export interface BrowserAccountContext {
  id: string;
  proxy_port?: number;
  fingerprint: AccountFingerprint;
  persona: AccountPersona;
  profile_path: string;
  account_type?: string;
  warmup_day?: number;
  health_score?: number;
}

function canUseHeadfulBrowser(): boolean {
  if (process.platform !== 'linux') return false;
  return process.env.DISPLAY === ':99' || process.env.XVFB_AVAILABLE === 'true';
}

function baseLaunchArgs(fp: AccountFingerprint) {
  return [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-blink-features=AutomationControlled',
    `--window-size=${fp.screenWidth},${fp.screenHeight}`,
    fp.useSoftwareGL ? '--use-gl=swiftshader' : '--use-gl=desktop',
    `--font-render-hinting=${fp.fontHint}`,
    '--webrtc-ip-handling-policy=disable_non_proxied_udp',
    '--force-webrtc-ip-handling-policy',
  ];
}

function persistentLaunchOptions(account: BrowserAccountContext, fpConfig: Awaited<ReturnType<typeof getFingerprintConfig>>) {
  const fp = account.fingerprint;
  const headless = process.env.PLAYWRIGHT_HEADLESS === 'true' || !canUseHeadfulBrowser();

  const proxy = account.proxy_port
    ? { server: `socks5://127.0.0.1:${account.proxy_port}` }
    : undefined;

  return {
    headless,
    args: baseLaunchArgs(fp),
    proxy,
    userAgent: fp.userAgent,
    viewport: { width: fp.screenWidth, height: fp.screenHeight },
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH }
      : {}),
    env: headless ? undefined : { DISPLAY: process.env.DISPLAY ?? ':99' },
    fpConfig,
  };
}

export async function createBrowserForAccount(account: BrowserAccountContext) {
  mkdirSync(account.profile_path, { recursive: true });
  const fpConfig = await getFingerprintConfig();
  const opts = persistentLaunchOptions(account, fpConfig);
  const { fpConfig: cfg, ...launchOpts } = opts;

  const context = await chromium.launchPersistentContext(account.profile_path, launchOpts);
  await injectFingerprint(context, account.fingerprint, cfg);
  return { context };
}

export async function closeBrowserContext(context: BrowserContext) {
  await context.close();
}

/** @deprecated persistentContext 사용 — closeBrowserContext 권장 */
export async function closeBrowser(
  _browser: unknown,
  context: BrowserContext,
  _account?: Pick<BrowserAccountContext, 'profile_path'>,
) {
  await closeBrowserContext(context);
}

/** 레거시: 계정 없는 크롤 등 */
export async function createBrowser(proxyPort?: number) {
  const browser = await chromium.launch({
    headless: process.env.PLAYWRIGHT_HEADLESS !== 'false',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--webrtc-ip-handling-policy=disable_non_proxied_udp',
    ],
    proxy: proxyPort ? { server: `socks5://127.0.0.1:${proxyPort}` } : undefined,
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
  });
  return { browser, context };
}

export { chromium };
