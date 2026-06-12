import type { BrowserContext, Page } from 'playwright';
import { supabase } from '../../../middleware/auth.js';
import { decrypt } from '../../../lib/crypto.js';
import {
  classifyNaverLoginPage,
  wrapNaverLoginTimeout,
} from '../../../lib/naver-login-error.js';
import {
  clickNaverLoginButton,
  typeIntoNaverLoginField,
} from '../../../lib/naver-login-fields.js';
import { humanSleep } from '../../human-engine/typing.js';
import { randomBetween, sleep } from '../../../lib/utils.js';
import { shadowWalk } from '../shadow-walk.js';
import { hasStoredSession } from '../account-loader.js';
import { acquireWorkflowPage, releaseWorkflowPage } from '../browser.js';
import {
  type NaverCaptchaVisionContext,
  isNaverCaptchaVisible,
  tryAutoSolveNaverCaptcha,
} from '../../../lib/naver-captcha-vision.js';
import { shouldPreserveBrowserPageForVnc } from '../../watcher/captcha-hold.js';
import { escapeBlogHomeAfterLogin } from '../../../lib/naver-blog-portal.js';
import { isNaverAuthChallengePage } from '../../../lib/posting-captcha-session.js';

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

async function resolveLoginCaptchaIfNeeded(
  page: Page,
  captchaCtx?: NaverCaptchaVisionContext,
): Promise<void> {
  try {
    await tryAutoSolveNaverCaptcha(page, {
      ...captchaCtx,
    });
  } catch (err) {
    // Vision·클릭 오류 시 캡차 화면이면 VNC hold로 넘김 (HUMAN_CLICK_NO_BBOX 등)
    if (await isNaverCaptchaVisible(page)) {
      throw new Error('CAPTCHA_DETECTED');
    }
    throw err;
  }
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

  if (await isNaverAuthChallengePage(page)) {
    const url = page.url().toLowerCase();
    if (url.includes('device') || url.includes('new_env')) {
      throw new Error('NAVER_LOGIN_DEVICE_VERIFY');
    }
    throw new Error('NAVER_LOGIN_2FA');
  }

  const errText = await readNaverLoginErrorText(page);
  const code = classifyNaverLoginPage(url, errText);
  if (code) throw new Error(code);
}

/** VNC CAPTCHA 해결 후 — 프로필 세션이 살아 있으면 로그인 폼을 건너뜀 */
export async function ensureNaverLoggedIn(
  context: BrowserContext,
  accountId: string,
  options?: {
    profilePath?: string;
    navTimeoutMs?: number;
    fastCheck?: boolean;
    keepSessionPage?: boolean;
  },
): Promise<void> {
  const navTimeout = options?.navTimeoutMs ?? NAV_TIMEOUT_MS;
  const page = await acquireWorkflowPage(context);
  let preservePageForVnc = false;

  try {
    await page.goto('https://www.naver.com', { waitUntil: 'commit', timeout: navTimeout });
    await humanSleep(options?.fastCheck ? 400 : 1500, options?.fastCheck ? 800 : 2500);
    await escapeBlogHomeAfterLogin(page);
    const loginVisible = await page
      .locator('a[href*="nidlogin.login"]')
      .first()
      .isVisible()
      .catch(() => false);
    if (loginVisible) {
      if (!options?.keepSessionPage) await releaseWorkflowPage(context, page);
      await naverLogin(context, accountId, {
        profilePath: options?.profilePath,
        skipShadowWalk: true,
        navTimeoutMs: navTimeout,
        keepSessionPage: options?.keepSessionPage,
      });
      return;
    }
  } catch (err) {
    if (shouldPreserveBrowserPageForVnc(err)) preservePageForVnc = true;
    throw err;
  } finally {
    if (!preservePageForVnc && !options?.keepSessionPage) await releaseWorkflowPage(context, page);
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
    /** post_blog — 로그인 탭을 about:blank 로 비우고 유지 */
    keepSessionPage?: boolean;
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
    await typeIntoNaverLoginField(page, '#id', account.naver_id);
    await humanSleep(500, 1200);
    await typeIntoNaverLoginField(page, '#pw', password);
    await humanSleep(800, 1500);
    await clickNaverLoginButton(page);

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
    await escapeBlogHomeAfterLogin(page);
  } catch (err) {
    if (shouldPreserveBrowserPageForVnc(err)) preservePageForVnc = true;
    throw err;
  } finally {
    if (!preservePageForVnc && !options?.keepSessionPage) {
      await releaseWorkflowPage(context, page);
    }
  }
}
