import type { Page } from 'playwright';

import { supabase } from '../middleware/auth.js';
import { decrypt } from './crypto.js';
import { humanSleep } from '../modules/human-engine/typing.js';
import { humanClickLocator, humanMouseMove } from '../modules/human-engine/mouse.js';
import { logOperation } from './log-emitter.js';
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

async function clickIpSecurityOffWithMouse(page: Page, ipOn: ReturnType<Page['locator']>): Promise<void> {
  const label = page.locator('#label_ip_on, label[for="ip_on"]').first();
  const targets = [label, ipOn];
  for (const target of targets) {
    if ((await target.count().catch(() => 0)) === 0) continue;
    if (!(await target.isVisible().catch(() => false))) continue;
    await humanClickLocator(page, target);
    await sleep(randomBetween(150, 350));
    if (!(await ipOn.isChecked().catch(() => false))) return;
  }

  const box = await ipOn.boundingBox().catch(() => null);
  if (box && box.width > 0 && box.height > 0) {
    const cx = box.x + box.width / 2 + randomBetween(-2, 2);
    const cy = box.y + box.height / 2 + randomBetween(-2, 2);
    await humanMouseMove(page, cx, cy);
    await sleep(randomBetween(100, 250));
    await page.mouse.click(cx, cy);
    await sleep(randomBetween(150, 350));
  }
}

/** nidlogin IP보안(#ip_on) — 모뎀·프록시 환경에서는 OFF(체크 해제) 필요. JS 폴백 없이 마우스만. */
export async function ensureNaverIpSecurityOff(page: Page): Promise<void> {
  if (!page.url().includes('nidlogin')) return;
  await ensureNaverLoginIdPhoneTab(page);

  const ipOn = page.locator('#ip_on');
  if ((await ipOn.count().catch(() => 0)) === 0) return;
  if (!(await ipOn.isVisible().catch(() => false))) return;
  if (!(await ipOn.isChecked().catch(() => false))) return;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (!(await ipOn.isChecked().catch(() => false))) return;
    await clickIpSecurityOffWithMouse(page, ipOn);
  }

  if (await ipOn.isChecked().catch(() => false)) {
    await logOperation({
      level: 'warn',
      message: '[login] IP보안 OFF 실패 — #ip_on 여전히 체크됨 (마우스 3회 시도)',
    }).catch(() => {});
  }
}

/** 사람처럼 필드 클릭→포커스 후 한 글자씩 입력 (keydown/keyup/input 이벤트 발생). */
export async function typeIntoNaverLoginField(
  page: Page,
  selector: string,
  value: string,
  options?: { fast?: boolean; clear?: boolean },
): Promise<void> {
  await ensureNaverLoginIdPhoneTab(page);
  await ensureNaverIpSecurityOff(page);

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
 * CAPTCHA 전환·오답 후 네이버가 로그인 폼을 비우는 경우 —
 * ID만 비었으면 ID+PW, PW만 비었으면 PW만 재입력 (최초 로그인과 동일 순서).
 */
export async function ensureNaverLoginCredentialsForCaptcha(
  page: Page,
  accountId: string,
  options?: { fast?: boolean },
): Promise<void> {
  if (!page.url().includes('nidlogin')) return;

  await ensureNaverLoginIdPhoneTab(page);
  await ensureNaverIpSecurityOff(page);

  const { data: account } = await supabase
    .from('huma_accounts')
    .select('naver_id, naver_pw_enc')
    .eq('id', accountId)
    .single();
  if (!account) return;

  const idVal = await page.locator('#id').inputValue().catch(() => '');
  const pwVal = await page.locator('#pw').inputValue().catch(() => '');
  const needId = !idVal.trim();
  const needPw = !pwVal.trim();

  if (!needId && !needPw) return;

  if (needId) {
    await typeIntoNaverLoginField(page, '#id', account.naver_id, { fast: options?.fast });
    await humanSleep(options?.fast ? 120 : 400, options?.fast ? 280 : 900);
  }

  if (needId || needPw) {
    const password = decrypt(account.naver_pw_enc);
    await typeIntoNaverLoginField(page, '#pw', password, { fast: options?.fast });
    await humanSleep(options?.fast ? 120 : 400, options?.fast ? 280 : 900);
  }
}

/**
 * CAPTCHA 통과 후 nidlogin — 필요 시 ID·PW 재입력 후 로그인 버튼 클릭.
 */
export async function submitNaverLoginAfterCaptcha(
  page: Page,
  accountId: string,
): Promise<boolean> {
  if (!page.url().includes('nidlogin')) return false;

  await ensureNaverLoginIdPhoneTab(page);
  await ensureNaverIpSecurityOff(page);
  if (accountId) {
    await ensureNaverLoginCredentialsForCaptcha(page, accountId, { fast: true }).catch(() => {});
  }
  await humanSleep(250, 500);
  await clickNaverLoginButton(page);
  await page
    .waitForURL((u) => !u.href.includes('nidlogin'), { timeout: 25_000 })
    .catch(() => {});
  return !page.url().includes('nidlogin');
}

/** 로그인 버튼 — humanClickLocator만 사용 (force click 금지). */
export async function clickNaverLoginButton(page: Page): Promise<void> {
  await ensureNaverLoginIdPhoneTab(page);
  await ensureNaverIpSecurityOff(page);

  for (const sel of NAVER_LOGIN_BTN_SELECTORS) {
    const btn = page.locator(sel).first();
    if (!(await btn.isVisible().catch(() => false))) continue;
    await btn.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const box = await btn.boundingBox().catch(() => null);
      if (box && box.width > 0 && box.height > 0) {
        await humanClickLocator(page, btn);
        return;
      }
      await sleep(250);
    }
  }
  throw new Error('NAVER_LOGIN_BTN_NOT_FOUND');
}
