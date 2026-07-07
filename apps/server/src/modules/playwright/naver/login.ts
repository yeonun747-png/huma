import type { BrowserContext, Page } from 'playwright';

import { supabase } from '../../../middleware/auth.js';
import { decrypt } from '../../../lib/crypto.js';
import {
  classifyNaverLoginPage,
  wrapNaverLoginTimeout,
} from '../../../lib/naver-login-error.js';
import {
  ensureNaverLoginIdPhoneTab,
  submitNaverLoginAfterPasswordEnter,
  typeIntoNaverLoginField,
  ensureNaverIpSecurityOff,
} from '../../../lib/naver-login-fields.js';
import {
  acquireNaverLoginPage,
  consolidateNaverLoginTabs,
  NAVER_LOGIN_ID_URL,
} from '../../../lib/naver-login-session.js';
import { humanSleep } from '../../human-engine/typing.js';
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
import { isNaverAuthChallengePage, pollUntilNaverLoginRedirect, NAVER_LOGIN_POST_SUBMIT_TIMEOUT_MS } from '../../../lib/posting-captcha-session.js';
import { throwIfNaverAccountProtection } from '../../../lib/naver-account-protection.js';

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
    const run = await tryAutoSolveNaverCaptcha(page, {
      ...captchaCtx,
    });
    if (run.result === 'failed' && run.failureReason === 'auth_challenge') {
      throw new Error('NAVER_LOGIN_2FA');
    }
  } catch (err) {
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
  await resolveLoginCaptchaIfNeeded(page, captchaCtx);

  await throwIfNaverAccountProtection(page, 'login');

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
  const code = classifyNaverLoginPage(page.url(), errText);
  if (code) throw new Error(code);
}

async function loadAccountCredentials(accountId: string) {
  const { data: account } = await supabase
    .from('huma_accounts')
    .select('naver_id, naver_pw_enc, profile_path')
    .eq('id', accountId)
    .single();
  if (!account) throw new Error('계정 없음');
  return account;
}

/** 단일 탭에서 nid 로그인 폼 입력·제출 */
async function performNaverLoginOnPage(
  page: Page,
  accountId: string,
  options?: {
    skipShadowWalk?: boolean;
    navTimeoutMs?: number;
    captchaContext?: NaverCaptchaVisionContext;
    profilePath?: string;
  },
): Promise<void> {
  const navTimeout = options?.navTimeoutMs ?? NAV_TIMEOUT_MS;
  const account = await loadAccountCredentials(accountId);
  const profilePath = options?.profilePath ?? account.profile_path;
  const hasSession = profilePath ? hasStoredSession(profilePath) : false;

  if (!hasSession && !options?.skipShadowWalk) {
    await shadowWalk(page).catch((err) => {
      throw wrapNaverLoginTimeout('shadow_walk', err);
    });
  }

  if (!page.url().includes('nidlogin')) {
    try {
      await page.goto(NAVER_LOGIN_ID_URL, { waitUntil: 'domcontentloaded', timeout: navTimeout });
    } catch (err) {
      throw wrapNaverLoginTimeout('page_load', err);
    }
  }

  if (await isNaverAuthChallengePage(page)) {
    const url = page.url().toLowerCase();
    if (url.includes('device') || url.includes('new_env')) {
      throw new Error('NAVER_LOGIN_DEVICE_VERIFY');
    }
    throw new Error('NAVER_LOGIN_2FA');
  }

  await consolidateNaverLoginTabs(page.context(), page);
  if (await isNaverAuthChallengePage(page)) {
    throw new Error('NAVER_LOGIN_2FA');
  }
  await ensureNaverLoginIdPhoneTab(page);

  try {
    await page.waitForSelector('#id', { timeout: 30_000 });
  } catch (err) {
    throw wrapNaverLoginTimeout('login_form', err);
  }
  await ensureNaverIpSecurityOff(page);
  await humanSleep(250, 500);

  const password = decrypt(account.naver_pw_enc);
  const fieldOpts = { fast: true, skipSetup: true } as const;
  await typeIntoNaverLoginField(page, '#id', account.naver_id, fieldOpts);
  await humanSleep(200, 450);
  await typeIntoNaverLoginField(page, '#pw', password, fieldOpts);
  try {
    await submitNaverLoginAfterPasswordEnter(page, { skipIpSecurity: true });
  } catch (err) {
    const msg = (err as Error).message ?? '';
    if (msg.includes('NAVER_LOGIN_CREDENTIALS') || msg.includes('NAVER_LOGIN_2FA')) throw err;
    if (await isNaverCaptchaVisible(page)) {
      /* 다음(다단계) 클릭 후 캡차 — pollUntil에서 CAPTCHA_DETECTED 처리 */
    } else {
      throw err;
    }
  }

  const captchaCtx: NaverCaptchaVisionContext = {
    accountId,
    ...options?.captchaContext,
  };

  await pollUntilNaverLoginRedirect(page, {
    timeoutMs: NAVER_LOGIN_POST_SUBMIT_TIMEOUT_MS,
    assertOk: (p) => assertLoginSucceeded(p, captchaCtx),
    captchaCtx,
  });
  await humanSleep(400, 900);

  await assertLoginSucceeded(page, captchaCtx);
  await throwIfNaverAccountProtection(page, 'login');
  await escapeBlogHomeAfterLogin(page);
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
      if (options?.keepSessionPage) {
        await performNaverLoginOnPage(page, accountId, {
          profilePath: options?.profilePath,
          skipShadowWalk: true,
          navTimeoutMs: navTimeout,
        });
      } else {
        await releaseWorkflowPage(context, page);
        await naverLogin(context, accountId, {
          profilePath: options?.profilePath,
          skipShadowWalk: true,
          navTimeoutMs: navTimeout,
          keepSessionPage: options?.keepSessionPage,
        });
      }
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
  const page = await acquireNaverLoginPage(context);
  let preservePageForVnc = false;

  try {
    await performNaverLoginOnPage(page, accountId, options);
  } catch (err) {
    if (shouldPreserveBrowserPageForVnc(err)) preservePageForVnc = true;
    throw err;
  } finally {
    if (!preservePageForVnc && !options?.keepSessionPage) {
      await releaseWorkflowPage(context, page);
    }
  }
}
