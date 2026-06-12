import type { Page } from 'playwright';

import { supabase } from '../middleware/auth.js';
import { decrypt } from './crypto.js';
import { humanSleep } from '../modules/human-engine/typing.js';
import { humanClickLocator } from '../modules/human-engine/mouse.js';
import { randomBetween, sleep } from './utils.js';

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
): Promise<void> {
  const loc = page.locator(selector);
  await loc.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
  const box = await loc.boundingBox().catch(() => null);
  if (box && box.width > 0 && box.height > 0) {
    await humanClickLocator(page, loc);
  } else {
    await loc.focus().catch(() => {});
  }
  await sleep(randomBetween(150, 400));
  for (const ch of value) {
    await page.keyboard.type(ch, { delay: randomBetween(55, 175) });
    if (Math.random() < 0.08) await sleep(randomBetween(180, 520));
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

  const { data: account } = await supabase
    .from('huma_accounts')
    .select('naver_pw_enc')
    .eq('id', accountId)
    .single();
  if (!account) return;

  const password = decrypt(account.naver_pw_enc);
  const pw = page.locator('#pw');
  await pw.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
  await pw.fill('').catch(() => {});

  if (options?.fast) {
    await pw.fill(password);
    await humanSleep(120, 280);
    return;
  }

  await typeIntoNaverLoginField(page, '#pw', password);
  await humanSleep(400, 900);
}

/** 로그인 버튼 — bbox 없을 때 force click 폴백. */
export async function clickNaverLoginButton(page: Page): Promise<void> {
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
