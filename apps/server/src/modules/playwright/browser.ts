import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import type { BrowserContext } from 'playwright';
import { existsSync, mkdirSync, rmSync, unlinkSync } from 'fs';
import { join } from 'path';
import {
  injectFingerprint,
  normalizeFingerprintForLaunch,
  type AccountFingerprint,
} from './fingerprint.js';
import type { AccountPersona } from './persona.js';
import { getFingerprintConfig, getHumanEngineConfig } from '../../lib/settings.js';
import { getBundledChromiumVersion, syncUserAgentChromeVersion } from '../../lib/chromium-version.js';
import { resolveUseOsIme } from '../human-engine/os-ime.js';
import { logOperation } from '../../lib/log-emitter.js';

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

/** i7 Xvfb(:99) — desktop GL 없음 → angle(egl) 필수. desktop이면 GPU process 즉시 종료 */
function resolveGlLaunchArg(): string {
  if (process.platform === 'linux') return '--use-gl=angle';
  return '--use-gl=desktop';
}

/** Playwright `proxy` 옵션은 ~NOTFOUND host-resolver-rules를 주입 — Chromium 131 파싱 실패 */
function proxyChromiumArgs(proxyPort: number): string[] {
  return [
    `--proxy-server=socks5://127.0.0.1:${proxyPort}`,
    '--proxy-bypass-list=<-loopback>',
    '--host-resolver-rules=MAP * ^NOTFOUND , EXCLUDE 127.0.0.1',
  ];
}

function clearStaleProfileLocks(profilePath: string): void {
  for (const name of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
    const lockPath = join(profilePath, name);
    try {
      if (existsSync(lockPath)) unlinkSync(lockPath);
    } catch {
      // 다른 프로세스가 사용 중이면 launch가 실패하므로 무시
    }
  }
}

/** GPUCache·Preferences 손상 시 elf_dynamic_array_reader 크래시 — 캐시만 정리 */
const PROFILE_REPAIR_DIRS = [
  'GPUCache',
  'GrShaderCache',
  'ShaderCache',
  'DawnGraphiteCache',
  'DawnWebGPUCache',
  'GraphiteDawnCache',
  'Code Cache',
  'Service Worker',
  'Cache',
  'CacheStorage',
  'blob_storage',
  'BrowserMetrics',
  'Crashpad',
];

function repairBrowserProfile(profilePath: string, aggressive = false): void {
  clearStaleProfileLocks(profilePath);
  for (const name of PROFILE_REPAIR_DIRS) {
    try {
      rmSync(join(profilePath, name), { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
  if (aggressive) {
    for (const file of ['Local State', 'Preferences', 'First Run', 'Last Version']) {
      try {
        const p = join(profilePath, file);
        if (existsSync(p)) unlinkSync(p);
      } catch {
        /* ignore */
      }
    }
  }
}

function isBrowserLaunchCorruptionError(err: unknown): boolean {
  const msg = String((err as Error)?.message ?? err);
  return (
    msg.includes('launchPersistentContext') ||
    msg.includes('Target page, context or browser has been closed') ||
    msg.includes('elf_dynamic_array_reader')
  );
}

function baseLaunchArgs(fp: AccountFingerprint) {
  const args = [
    '--disable-setuid-sandbox',
    '--disable-blink-features=AutomationControlled',
    `--window-size=${fp.screenWidth},${fp.screenHeight}`,
    resolveGlLaunchArg(),
    `--font-render-hinting=${fp.fontHint}`,
    '--lang=ko-KR',
    '--webrtc-ip-handling-policy=disable_non_proxied_udp',
    '--force-webrtc-ip-handling-policy',
  ];
  if (process.platform === 'linux') {
    args.unshift('--no-sandbox', '--disable-dev-shm-usage');
  }
  return args;
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

/**
 * Chromium subprocess env — fcitx GTK 모듈·invalid DBUS 상속 금지.
 * 한글 IME는 worker에서 fcitx-remote로 별도 제어 (os-ime.ts).
 */
function buildBrowserEnv(headless: boolean, _useOsIme: boolean): Record<string, string> | undefined {
  if (headless) return undefined;
  const env: Record<string, string> = {
    DISPLAY: process.env.DISPLAY ?? ':99',
    LANG: 'ko_KR.UTF-8',
    LC_CTYPE: 'ko_KR.UTF-8',
    DBUS_SESSION_BUS_ADDRESS: 'disabled:',
  };
  for (const key of ['GTK_IM_MODULE', 'QT_IM_MODULE', 'XMODIFIERS', 'INPUT_METHOD']) {
    env[key] = '';
  }
  return env;
}

async function launchPersistentContextWithRecovery(
  profilePath: string,
  launchOpts: Omit<ReturnType<typeof persistentLaunchOptions>, 'fpConfig'>,
  accountId?: string,
): Promise<BrowserContext> {
  try {
    return await chromium.launchPersistentContext(profilePath, launchOpts);
  } catch (firstErr) {
    if (!isBrowserLaunchCorruptionError(firstErr)) throw firstErr;

    repairBrowserProfile(profilePath, false);
    await logOperation({
      level: 'warn',
      message: `[browser] 프로필 캐시 정리 후 Chromium 재기동: ${profilePath}`,
      account_id: accountId,
    });

    try {
      return await chromium.launchPersistentContext(profilePath, launchOpts);
    } catch (secondErr) {
      if (!isBrowserLaunchCorruptionError(secondErr)) throw secondErr;

      repairBrowserProfile(profilePath, true);
      await logOperation({
        level: 'warn',
        message: `[browser] 프로필 Preferences 초기화 후 Chromium 재기동: ${profilePath}`,
        account_id: accountId,
      });
      return chromium.launchPersistentContext(profilePath, launchOpts);
    }
  }
}

function persistentLaunchOptions(
  account: BrowserAccountContext,
  fp: AccountFingerprint,
  fpConfig: Awaited<ReturnType<typeof getFingerprintConfig>>,
  useOsIme: boolean,
) {
  const headless = resolveHeadless();

  const proxyArgs = account.proxy_port ? proxyChromiumArgs(account.proxy_port) : [];

  return {
    headless,
    args: [...baseLaunchArgs(fp), ...proxyArgs],
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
  clearStaleProfileLocks(account.profile_path);
  const fpConfig = await getFingerprintConfig();
  const humanCfg = await getHumanEngineConfig();
  const useOsIme = resolveUseOsIme(humanCfg);
  const fp = await resolveLaunchFingerprint(account);
  const opts = persistentLaunchOptions(account, fp, fpConfig, useOsIme);
  const { fpConfig: cfg, ...launchOpts } = opts;

  const context = await launchPersistentContextWithRecovery(
    account.profile_path,
    launchOpts,
    account.id,
  );
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
    env: buildBrowserEnv(headless, false),
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--lang=ko-KR',
      '--webrtc-ip-handling-policy=disable_non_proxied_udp',
      ...(proxyPort ? proxyChromiumArgs(proxyPort) : []),
      ...(process.platform === 'linux' ? [resolveGlLaunchArg()] : []),
    ],
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
  });
  return { browser, context };
}

export { chromium };
