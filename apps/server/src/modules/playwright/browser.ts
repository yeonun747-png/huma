import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import type { BrowserContext, Page } from 'playwright';
import { existsSync, mkdirSync, renameSync, rmSync, unlinkSync } from 'fs';
import { join } from 'path';
import {
  injectFingerprint,
  normalizeFingerprintForLaunch,
  normalizeUaPlatform,
  type AccountFingerprint,
} from './fingerprint.js';
import type { AccountPersona } from './persona.js';
import { getFingerprintConfig, getHumanEngineConfig } from '../../lib/settings.js';
import { getBundledChromiumVersion, syncUserAgentChromeVersion } from '../../lib/chromium-version.js';
import { resolveUseOsIme, fcitxBrowserEnv } from '../human-engine/os-ime.js';
import { logOperation } from '../../lib/log-emitter.js';
import { PLAYWRIGHT_NAV_TIMEOUT_MS } from '../../lib/playwright-nav-timeout.js';

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

/** Playwright 기본 --enable-automation → Chrome 자동화 배너·탐지 신호 */
const IGNORE_AUTOMATION_ARGS = ['--enable-automation'] as const;

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
    userAgent: normalizeUaPlatform(syncUserAgentChromeVersion(normalized.userAgent, chromiumVersion)),
  };
}

/**
 * Sec-CH-UA-Platform 등 클라이언트 힌트 헤더는 크롬 네트워크 엔진이 실제 OS(i7=Linux) 기준으로 붙인다.
 * UA·navigator는 Windows로 위장했는데 이 헤더만 "Linux"면 서버에서 UA-OS 불일치로 탐지된다.
 * 모든 요청의 platform 힌트를 Windows로 통일해 JS·헤더를 정합시킨다.
 * (이미지/폰트 abort 라우트는 세션에서 나중에 등록되어 우선 실행되므로 충돌 없음.)
 */
async function applyClientHintPlatformSpoof(context: BrowserContext): Promise<void> {
  await context.route('**/*', async (route) => {
    const headers = route.request().headers();
    headers['sec-ch-ua-platform'] = '"Windows"';
    headers['sec-ch-ua-platform-version'] = '"15.0.0"';
    await route.continue({ headers });
  });
}

/**
 * Chromium subprocess env.
 * - 기본(useOsIme=false): fcitx GTK 모듈·invalid DBUS 상속 금지 (DBus 크래시 방지). 합성 IME 사용.
 * - useOsIme=true: fcitx 모듈 + 실제 DBus 세션을 주입해야 OS IME 한글 조합이 동작.
 *   (둘은 상호 배타 — env를 입력 방식과 정합시킨다.)
 */
function buildBrowserEnv(headless: boolean, useOsIme: boolean): Record<string, string> | undefined {
  if (headless) return undefined;

  const env: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(([, v]) => v != null) as [string, string][],
    ),
    DISPLAY: process.env.DISPLAY ?? ':99',
    LANG: 'ko_KR.UTF-8',
    LC_CTYPE: 'ko_KR.UTF-8',
  };

  if (useOsIme) {
    const dbus = process.env.DBUS_SESSION_BUS_ADDRESS;
    if (dbus?.startsWith('unix:')) {
      env.DBUS_SESSION_BUS_ADDRESS = dbus;
    }
    return fcitxBrowserEnv(env);
  }

  // SSH/PM2의 잘못된 DBUS(예: disabled:) → bus.cc 파싱 크래시. 합성 IME 경로에서는 DBUS 제거.
  delete env.DBUS_SESSION_BUS_ADDRESS;
  delete env.DBUS_SYSTEM_BUS_ADDRESS;
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

      try {
        return await chromium.launchPersistentContext(profilePath, launchOpts);
      } catch (thirdErr) {
        if (!isBrowserLaunchCorruptionError(thirdErr)) throw thirdErr;

        const backupPath = `${profilePath}.corrupt-${Date.now()}`;
        try {
          if (existsSync(profilePath)) renameSync(profilePath, backupPath);
        } catch {
          rmSync(profilePath, { recursive: true, force: true });
        }
        mkdirSync(profilePath, { recursive: true });
        await logOperation({
          level: 'warn',
          message: `[browser] 프로필 전체 교체 후 Chromium 재기동: ${profilePath}`,
          account_id: accountId,
        });
        return chromium.launchPersistentContext(profilePath, launchOpts);
      }
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
    ignoreDefaultArgs: [...IGNORE_AUTOMATION_ARGS],
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
  await prepareCleanBrowserTabs(context);
  context.setDefaultNavigationTimeout(PLAYWRIGHT_NAV_TIMEOUT_MS);
  context.setDefaultTimeout(PLAYWRIGHT_NAV_TIMEOUT_MS);
  await injectFingerprint(context, fp, cfg);
  await applyClientHintPlatformSpoof(context);

  context.on('page', (page) => {
    void import('../human-engine/mouse.js').then(({ seedMousePosition }) => {
      seedMousePosition(page);
    });
  });

  return { context };
}

/** 기동 시 중복·복원 탭 정리 — persistent context는 마지막 탭까지 닫으면 Chromium이 종료됨 */
export async function prepareCleanBrowserTabs(context: BrowserContext): Promise<void> {
  const pages = [...context.pages()];
  if (pages.length === 0) return;

  const keeper = pages[0]!;
  for (const page of pages.slice(1)) {
    await page.close().catch(() => {});
  }

  const url = keeper.url();
  if (url !== 'about:blank' && url !== 'chrome://newtab/' && url !== '') {
    await keeper.goto('about:blank').catch(() => {});
  }
}

/** 워크플로우용 탭 1개 — 불필요한 about:blank 중복 탭 방지 */
export async function acquireWorkflowPage(context: BrowserContext): Promise<Page> {
  const pages = context.pages();
  if (pages.length === 0) return context.newPage();
  const reusable = pages.find((p) => {
    const url = p.url();
    return url === 'about:blank' || url === 'chrome://newtab/' || url === '';
  });
  return reusable ?? context.newPage();
}

/**
 * persistent context — 마지막 탭 close 시 Chromium 전체 종료.
 * 워밍업·로그인 후 탭 정리는 about:blank 로 되돌리고, 여분 탭만 close.
 */
export async function releaseWorkflowPage(context: BrowserContext, page: Page): Promise<void> {
  const pages = context.pages();
  if (pages.length > 1) {
    await page.close().catch(() => {});
    return;
  }
  await page.goto('about:blank', { waitUntil: 'domcontentloaded', timeout: 15_000 }).catch(() => {});
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
    ignoreDefaultArgs: [...IGNORE_AUTOMATION_ARGS],
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
