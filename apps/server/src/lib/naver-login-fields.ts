import type { Page } from 'playwright';

import { supabase } from '../middleware/auth.js';
import { decrypt } from './crypto.js';
import { humanSleep } from '../modules/human-engine/typing.js';
import { humanClickLocator } from '../modules/human-engine/mouse.js';
import { randomBetween, sleep } from './utils.js';
import {
  ensureNaverLoginIdPhoneTab,
  NAVER_LOGIN_ID_URL,
} from './naver-login-session.js';

export { ensureNaverLoginIdPhoneTab, NAVER_LOGIN_ID_URL };

const NAVER_LOGIN_BTN_SELECTORS = [
  '#log\\.login',
  'button.btn_login',
  'input.btn_login',
  '.btn_login',
  'button[type="submit"]',
];

/** 사람처럼 필드 클릭→포커스 후 한 글자씩 입력 (keydown/keyup/input 이벤트 발생). */
export async function typeIntoNaverLoginField(
  page: Page,
  selector: string,
  value: string,
  options?: { fast?: boolean; clear?: boolean },
): Promise<void> {
  await ensureNaverLoginIdPhoneTab(page);

  const loc = page.locator(selector);
  await loc.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
  const box = await loc.boundingBox().catch(() => null);
  if (box && box.width > 0 && box.height > 0) {
    await humanClickLocator(page, loc);
  } else {
    await loc.focus().catch(() => {});
  }
  await sleep(options?.fast ? randomBetween(80, 180) : randomBetween(150, 400));

  if (options?.clear !== false) {
    const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
    await page.keyboard.press(`${mod}+a`).catch(() => {});
    await page.keyboard.press('Backspace').catch(() => {});
    await sleep(options?.fast ? randomBetween(40, 90) : randomBetween(80, 160));
  }

  const delayMin = options?.fast ? 35 : 55;
  const delayMax = options?.fast ? 95 : 175;
  for (const ch of value) {
    await page.keyboard.type(ch, { delay: randomBetween(delayMin, delayMax) });
    if (Math.random() < (options?.fast ? 0.04 : 0.08)) {
      await sleep(randomBetween(options?.fast ? 100 : 180, options?.fast ? 280 : 520));
    }
  }
}

/**
 * CAPTCHA 화면 전환 시 네이버가 비밀번호만 비우는 경우가 많음 — ID는 유지, PW만 재입력.
 */
export async function ensureNaverLoginCredentialsForCaptcha(
  page: Page,
  accountId: string,
  options?: { fast?: boolean },
): Promise<void> {
  if (!page.url().includes('nidlogin')) return;

  await ensureNaverLoginIdPhoneTab(page);

  const { data: account } = await supabase
    .from('huma_accounts')
    .select('naver_pw_enc')
    .eq('id', accountId)
    .single();
  if (!account) return;

  const password = decrypt(account.naver_pw_enc);
  await typeIntoNaverLoginField(page, '#pw', password, { fast: options?.fast });
  await humanSleep(options?.fast ? 120 : 400, options?.fast ? 280 : 900);
}

/**
 * CAPTCHA 통과 후 nidlogin — 비번(필요 시) 마우스 입력·로그인 버튼 마우스 클릭.
 * @returns nidlogin 이탈 여부
 */
export async function submitNaverLoginAfterCaptcha(
  page: Page,
  accountId: string,
): Promise<boolean> {
  if (!page.url().includes('nidlogin')) return false;

  await ensureNaverLoginIdPhoneTab(page);

  const pwVal = await page.locator('#pw').inputValue().catch(() => '');
  if (!pwVal.trim()) {
    await ensureNaverLoginCredentialsForCaptcha(page, accountId, { fast: true });
  } else {
    await humanSleep(180, 380);
  }

  await clickNaverLoginButton(page);
  await page
    .waitForURL((u) => !u.href.includes('nidlogin'), { timeout: 25_000 })
    .catch(() => {});
  return !page.url().includes('nidlogin');
}

/** 로그인 버튼 — bbox 없을 때 force click 폴백. */
export async function clickNaverLoginButton(page: Page): Promise<void> {
  await ensureNaverLoginIdPhoneTab(page);

  for (const sel of NAVER_LOGIN_BTN_SELECTORS) {
    const btn = page.locator(sel).first();
    if (!(await btn.isVisible().catch(() => false))) continue;
    const box = await btn.boundingBox().catch(() => null);
    if (box && box.width > 0 && box.height > 0) {
      await humanClickLocator(page, btn);
      return;
    }
    await btn.click({ force: true, timeout: 8000 });
    return;
  }
  throw new Error('NAVER_LOGIN_BTN_NOT_FOUND');
}
