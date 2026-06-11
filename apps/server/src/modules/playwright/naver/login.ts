import type { BrowserContext, Page } from 'playwright';
import { supabase } from '../../../middleware/auth.js';
import { decrypt } from '../../../lib/crypto.js';
import {
  classifyNaverLoginPage,
  wrapNaverLoginTimeout,
} from '../../../lib/naver-login-error.js';
import { humanSleep } from '../../human-engine/typing.js';
import { humanClickLocator } from '../../human-engine/mouse.js';
import { randomBetween, sleep } from '../../../lib/utils.js';
import { shadowWalk } from '../shadow-walk.js';
import { hasStoredSession } from '../account-loader.js';
import { acquireWorkflowPage, releaseWorkflowPage } from '../browser.js';
import {
  type NaverCaptchaVisionContext,
  tryAutoSolveNaverCaptcha,
} from '../../../lib/naver-captcha-vision.js';
import { shouldPreserveBrowserPageForVnc } from '../../watcher/captcha-hold.js';

const NAVER_LOGIN_URL = 'https://nid.naver.com/nidlogin.login';
const NAV_TIMEOUT_MS = 60_000;

async function readNaverLoginErrorText(page: Page): Promise<string | null> {
  const selectors = ['#err_common', '.error_message', '.err_msg', '#err_caps_lock'];
  for (const sel of selectors) {
    const text = await page
      .locator(sel)
      .first()
      .textContent({ timeout: 1500 })
      .catch(() => null);
    if (text?.trim()) return text.trim();
  }
  return null;
}

/** 사람처럼 필드 클릭→포커스 후 한 글자씩 입력 (keydown/keyup/input 이벤트 발생). */
async function typeIntoLoginField(page: Page, selector: string, value: string): Promise<void> {
  await humanClickLocator(page, page.locator(selector));
  await sleep(randomBetween(150, 400));
  for (const ch of value) {
    await page.keyboard.type(ch, { delay: randomBetween(55, 175) });
    // 가끔 입력 중 짧게 멈칫 (사람의 사고·확인)
    if (Math.random() < 0.08) await sleep(randomBetween(180, 520));
  }
}

async function resolveLoginCaptchaIfNeeded(
  page: Page,
  captchaCtx?: NaverCaptchaVisionContext,
): Promise<void> {
  await tryAutoSolveNaverCaptcha(page, {
    ...captchaCtx,
    resubmit: async () => {
      await humanClickLocator(page, page.locator('#log\\.login'));
    },
  });
}

async function assertLoginSucceeded(
  page: Page,
  captchaCtx?: NaverCaptchaVisionContext,
): Promise<void> {
  const url = page.url();
  await resolveLoginCaptchaIfNeeded(page, captchaCtx);

  const captchaVisible =
    (await page.locator('#captcha, .captcha, iframe[src*="captcha"]').count().catch(() => 0)) > 0;
  if (captchaVisible) {
    throw new Error('CAPTCHA_DETECTED');
  }

  const errText = await readNaverLoginErrorText(page);
  const code = classifyNaverLoginPage(url, errText);
  if (code) throw new Error(code);
}

/** VNC CAPTCHA 해결 후 — 프로필 세션이 살아 있으면 로그인 폼을 건너뜀 */
export async function ensureNaverLoggedIn(
  context: BrowserContext,
  accountId: string,
  options?: { profilePath?: string; navTimeoutMs?: number },
): Promise<void> {
  const navTimeout = options?.navTimeoutMs ?? NAV_TIMEOUT_MS;
  const page = await acquireWorkflowPage(context);
  let preservePageForVnc = false;

  try {
    await page.goto('https://www.naver.com', { waitUntil: 'domcontentloaded', timeout: navTimeout });
    await humanSleep(1500, 2500);
    const loginVisible = await page
      .locator('a[href*="nidlogin.login"]')
      .first()
      .isVisible()
      .catch(() => false);
    if (loginVisible) {
      await releaseWorkflowPage(context, page);
      await naverLogin(context, accountId, {
        profilePath: options?.profilePath,
        skipShadowWalk: true,
        navTimeoutMs: navTimeout,
      });
      return;
    }
  } catch (err) {
    if (shouldPreserveBrowserPageForVnc(err)) preservePageForVnc = true;
    throw err;
  } finally {
    if (!preservePageForVnc) await releaseWorkflowPage(context, page);
  }
}

export async function naverLogin(
  context: BrowserContext,
  accountId: string,
  options?: {
    profilePath?: string;
    skipShadowWalk?: boolean;
    navTimeoutMs?: number;
    captchaContext?: NaverCaptchaVisionContext;
  },
) {
  const navTimeout = options?.navTimeoutMs ?? NAV_TIMEOUT_MS;

  const { data: account } = await supabase
    .from('huma_accounts')
    .select('naver_id, naver_pw_enc, profile_path')
    .eq('id', accountId)
    .single();

  if (!account) throw new Error('계정 없음');

  const profilePath = options?.profilePath ?? account.profile_path;
  const hasSession = profilePath ? hasStoredSession(profilePath) : false;

  const page = await acquireWorkflowPage(context);
  let preservePageForVnc = false;

  try {
    if (!hasSession && !options?.skipShadowWalk) {
      await shadowWalk(page).catch((err) => {
        throw wrapNaverLoginTimeout('shadow_walk', err);
      });
    }

    try {
      await page.goto(NAVER_LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: navTimeout });
    } catch (err) {
      throw wrapNaverLoginTimeout('page_load', err);
    }

    try {
      await page.waitForSelector('#id', { timeout: 30_000 });
    } catch (err) {
      throw wrapNaverLoginTimeout('login_form', err);
    }
    await humanSleep(1000, 2000);

    const password = decrypt(account.naver_pw_enc);

    // 네이버 nid 로그인은 키입력 타이밍·이벤트(bvsd)를 분석한다.
    // page.fill()은 값만 즉시 주입해 keydown/keyup/input 엔트로피가 0 → 강한 봇 신호.
    // 사람처럼 필드를 클릭→포커스 후 키스트로크로 입력하고, 로그인 버튼도 마우스로 이동·클릭한다.
    await typeIntoLoginField(page, '#id', account.naver_id);
    await humanSleep(500, 1200);
    await typeIntoLoginField(page, '#pw', password);
    await humanSleep(800, 1500);
    await humanClickLocator(page, page.locator('#log\\.login'));

    const captchaCtx: NaverCaptchaVisionContext = {
      accountId,
      ...options?.captchaContext,
    };

    try {
      await page.waitForURL((url) => !url.href.includes('nidlogin.login'), { timeout: navTimeout });
    } catch (err) {
      await page.waitForLoadState('domcontentloaded').catch(() => {});
      await assertLoginSucceeded(page, captchaCtx);
      throw wrapNaverLoginTimeout('redirect', err);
    }
    await humanSleep(2000, 4000);

    await assertLoginSucceeded(page, captchaCtx);
  } catch (err) {
    if (shouldPreserveBrowserPageForVnc(err)) preservePageForVnc = true;
    throw err;
  } finally {
    if (!preservePageForVnc) await releaseWorkflowPage(context, page);
  }
}
