import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import type { BrowserContext } from 'playwright';
import { mkdirSync } from 'fs';
import {
  injectFingerprint,
  normalizeFingerprintForLaunch,
  type AccountFingerprint,
} from './fingerprint.js';
import type { AccountPersona } from './persona.js';
import { getFingerprintConfig, getHumanEngineConfig } from '../../lib/settings.js';
import { getBundledChromiumVersion, syncUserAgentChromeVersion } from '../../lib/chromium-version.js';
import { fcitxBrowserEnv, resolveUseOsIme } from '../human-engine/os-ime.js';

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

/** 기획서 규칙 ㉳: Xvfb(DISPLAY=:99) 없이 headless:false 실행 금지 */
export function assertXvfbForHeadfulBrowser(): void {
  if (process.env.PLAYWRIGHT_HEADLESS === 'true') return;
  if (process.platform !== 'linux') return;
  if (process.env.DISPLAY !== ':99') {
    throw new Error(
      'Xvfb 미실행: DISPLAY=:99 환경에서만 headless:false 브라우저를 실행할 수 있습니다 (규칙 ㉳)',
    );
  }
}

function resolveHeadless(): boolean {
  if (process.env.PLAYWRIGHT_HEADLESS === 'true') return true;
  assertXvfbForHeadfulBrowser();
  if (process.platform !== 'linux') return true;
  return false;
}

function baseLaunchArgs(fp: AccountFingerprint) {
  return [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-blink-features=AutomationControlled',
    `--window-size=${fp.screenWidth},${fp.screenHeight}`,
    '--use-gl=desktop',
    `--font-render-hinting=${fp.fontHint}`,
    '--lang=ko-KR',
    '--webrtc-ip-handling-policy=disable_non_proxied_udp',
    '--force-webrtc-ip-handling-policy',
  ];
}

async function resolveLaunchFingerprint(
  account: BrowserAccountContext,
): Promise<AccountFingerprint> {
  const normalized = normalizeFingerprintForLaunch(account.fingerprint, account.id);
  const chromiumVersion = await getBundledChromiumVersion();
  return {
    ...normalized,
    userAgent: syncUserAgentChromeVersion(normalized.userAgent, chromiumVersion),
  };
}

function buildBrowserEnv(headless: boolean, useOsIme: boolean): Record<string, string> | undefined {
  if (headless) return undefined;
  const base: Record<string, string> = {
    DISPLAY: process.env.DISPLAY ?? ':99',
    LANG: 'ko_KR.UTF-8',
  };
  return useOsIme ? fcitxBrowserEnv(base) : base;
}

function persistentLaunchOptions(
  account: BrowserAccountContext,
  fp: AccountFingerprint,
  fpConfig: Awaited<ReturnType<typeof getFingerprintConfig>>,
  useOsIme: boolean,
) {
  const headless = resolveHeadless();

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
    deviceScaleFactor: fp.devicePixelRatio ?? 1,
    ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH }
      : {}),
    env: buildBrowserEnv(headless, useOsIme),
    fpConfig,
  };
}

export async function createBrowserForAccount(account: BrowserAccountContext) {
  mkdirSync(account.profile_path, { recursive: true });
  const fpConfig = await getFingerprintConfig();
  const humanCfg = await getHumanEngineConfig();
  const useOsIme = resolveUseOsIme(humanCfg);
  const fp = await resolveLaunchFingerprint(account);
  const opts = persistentLaunchOptions(account, fp, fpConfig, useOsIme);
  const { fpConfig: cfg, ...launchOpts } = opts;

  const context = await chromium.launchPersistentContext(account.profile_path, launchOpts);
  await injectFingerprint(context, fp, cfg);

  context.on('page', (page) => {
    void import('../human-engine/mouse.js').then(({ seedMousePosition }) => {
      seedMousePosition(page);
    });
  });

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
  const headless = process.env.PLAYWRIGHT_HEADLESS === 'true' ? true : resolveHeadless();
  const browser = await chromium.launch({
    headless,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--lang=ko-KR',
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
