import { existsSync } from 'fs';
import { join } from 'path';
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import type { Browser, BrowserContext } from 'playwright';
import { injectFingerprint, type AccountFingerprint } from './fingerprint.js';
import type { AccountPersona } from './persona.js';

chromium.use(StealthPlugin());

void (async () => {
  try {
    const mod = 'rebrowser-patches';
    const rebrowser = await import(mod);
    if (typeof (rebrowser as { applyRebrowserPatches?: () => void }).applyRebrowserPatches === 'function') {
      (rebrowser as { applyRebrowserPatches: () => void }).applyRebrowserPatches();
    }
  } catch {
    // rebrowser-patches optional (Linux production)
  }
})();

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

function launchOptions(account: BrowserAccountContext) {
  const fp = account.fingerprint;
  const headless = process.env.PLAYWRIGHT_HEADLESS === 'true' || !canUseHeadfulBrowser();
  const args = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-blink-features=AutomationControlled',
    `--window-size=${fp.screenWidth},${fp.screenHeight}`,
    fp.useSoftwareGL ? '--use-gl=swiftshader' : '--use-gl=desktop',
    `--font-render-hinting=${fp.fontHint}`,
  ];

  const proxy = account.proxy_port
    ? { server: `socks5://127.0.0.1:${account.proxy_port}` }
    : undefined;

  return {
    headless,
    args,
    proxy,
    ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH }
      : {}),
    env: headless ? undefined : { DISPLAY: process.env.DISPLAY ?? ':99' },
  };
}

export async function createBrowserForAccount(account: BrowserAccountContext) {
  const browser = await chromium.launch(launchOptions(account));
  const statePath = join(account.profile_path, 'state.json');
  const context = await browser.newContext({
    userAgent: account.fingerprint.userAgent,
    viewport: {
      width: account.fingerprint.screenWidth,
      height: account.fingerprint.screenHeight,
    },
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    storageState: existsSync(statePath) ? statePath : undefined,
  });

  await injectFingerprint(context, account.fingerprint);
  return { browser, context };
}

export async function closeBrowser(
  browser: Browser,
  context: BrowserContext,
  account: Pick<BrowserAccountContext, 'profile_path'>
) {
  const statePath = join(account.profile_path, 'state.json');
  await context.storageState({ path: statePath }).catch(() => {});
  await browser.close();
}

/** 레거시: 계정 없는 크롤 등 */
export async function createBrowser(proxyPort?: number) {
  const browser = await chromium.launch({
    headless: process.env.PLAYWRIGHT_HEADLESS !== 'false',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
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
