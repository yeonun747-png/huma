import type { Locator, Page } from 'playwright';

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
import { isNaverAuthChallengePage } from './naver-auth-challenge.js';

export { ensureNaverLoginIdPhoneTab, NAVER_LOGIN_ID_URL };

const NAVER_LOGIN_BTN_SELECTORS = [
  '#log\\.login',
  'button.btn_login.next_step:not(.white)',
  'button.btn_login:not(.white)',
  'input.btn_login',
  '.btn_login',
  'button[type="submit"]',
];

async function findNaverLoginButton(page: Page): Promise<Locator | null> {
  for (const sel of NAVER_LOGIN_BTN_SELECTORS) {
    const btn = page.locator(sel).first();
    if ((await btn.count().catch(() => 0)) === 0) continue;
    if (await btn.isVisible().catch(() => false)) return btn;
  }
  return null;
}

async function isNaverLoginCaptchaOnPage(page: Page): Promise<boolean> {
  for (const sel of ['#captcha', '#cptch', '.captcha_wrap', 'iframe[src*="captcha"]']) {
    if (await page.locator(sel).first().isVisible({ timeout: 200 }).catch(() => false)) return true;
  }
  return false;
}

async function readNaverLoginInlineError(page: Page): Promise<string | null> {
  for (const sel of ['#err_common', '.error_message', '.err_msg', '#err_caps_lock']) {
    const text = await page.locator(sel).first().textContent({ timeout: 400 }).catch(() => null);
    if (text?.trim()) return text.trim();
  }
  return null;
}

/** nidlogin — 캡차·ID/PW 입력 후 off 클래스가 빠져야 클릭 유효 */
async function isNaverLoginButtonReady(btn: Locator): Promise<boolean> {
  if (!(await btn.isVisible().catch(() => false))) return false;
  if (await btn.isDisabled().catch(() => false)) return false;
  const cls = (await btn.getAttribute('class').catch(() => '')) ?? '';
  if (/\boff\b/.test(cls)) return false;
  const box = await btn.boundingBox().catch(() => null);
  return Boolean(box && box.width > 0 && box.height > 0);
}

async function waitForNaverLoginButtonReady(page: Page, timeoutMs = 6000): Promise<Locator | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const btn = await findNaverLoginButton(page);
    if (btn && (await isNaverLoginButtonReady(btn))) return btn;
    await sleep(120);
  }
  const btn = await findNaverLoginButton(page);
  if (btn && (await isNaverLoginButtonReady(btn))) return btn;
  return null;
}

/** off 잔류 시 — ID/PW가 채워졌으면 nidlogin JS 지연으로 마지막 시도 허용 */
async function canForceAttemptLoginButton(page: Page, btn: Locator): Promise<boolean> {
  if (!(await btn.isVisible().catch(() => false))) return false;
  const id = (await page.locator('#id').inputValue().catch(() => '')).trim();
  const pw = (await page.locator('#pw').inputValue().catch(() => '')).trim();
  return Boolean(id && pw);
}

async function didNaverLoginSubmitStart(page: Page): Promise<boolean> {
  const deadline = Date.now() + 3200;
  while (Date.now() < deadline) {
    if (await isNaverAuthChallengePage(page)) return true;
    if (await isNaverLoginCaptchaOnPage(page)) return true;
    if (!page.url().includes('nidlogin')) return true;
    await sleep(200);
  }
  return false;
}

async function tryNaverLoginSubmitFallback(page: Page, btn: Locator): Promise<boolean> {
  await page.locator('#pw').press('Enter').catch(() => {});
  await sleep(randomBetween(350, 650));
  if (await didNaverLoginSubmitStart(page)) return true;

  await page
    .evaluate(() => {
      const btnEl = document.getElementById('log.login') as HTMLButtonElement | null;
      btnEl?.click();
      const form = document.getElementById('frmNIDLogin') as HTMLFormElement | null;
      form?.requestSubmit?.();
    })
    .catch(() => {});
  await sleep(randomBetween(350, 650));
  if (await didNaverLoginSubmitStart(page)) return true;

  await btn.click({ timeout: 5000 }).catch(() => {});
  await sleep(randomBetween(350, 650));
  return didNaverLoginSubmitStart(page);
}

async function clickNaverLoginButtonOnce(page: Page, btn: Locator, round: number): Promise<void> {
  await btn.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
  // 캡차 입력칸 포커스가 남아 있으면 클릭이 빗나가는 경우가 있어 로그인 버튼 쪽으로 포커스 이동
  await btn.focus().catch(() => {});
  await sleep(randomBetween(80, 180));

  // nidlogin #log.login(type=button) — Playwright click이 JS 핸들러에 더 잘 맞음
  if (round % 2 === 0) {
    await btn.click({ timeout: 5000 });
    return;
  }

  const box = await btn.boundingBox().catch(() => null);
  if (!box || box.width <= 0 || box.height <= 0) {
    throw new Error('NAVER_LOGIN_BTN_NO_BBOX');
  }
  // 가장자리·IP보안 토글 오클릭 방지 — 중앙 40% 영역
  const marginX = box.width * 0.3;
  const marginY = box.height * 0.28;
  const cx = box.x + marginX + randomBetween(0, Math.max(1, Math.round(box.width - marginX * 2)));
  const cy = box.y + marginY + randomBetween(0, Math.max(1, Math.round(box.height - marginY * 2)));
  await humanMouseMove(page, cx, cy);
  await sleep(randomBetween(120, 280));
  await page.mouse.click(cx, cy);
}

/** IP보안 — 구 UI #ip_on / 신 UI #switch (2025~ nidlogin 리뉴얼). 클릭은 label·switch_btn */
const IP_SECURITY_INPUT_SELECTORS = ['#switch', '#ip_on'] as const;

const IP_SECURITY_SWITCH_SELECTORS = [
  'label[for="switch"]',
  'label.switch_btn',
  '#label_ip_on',
  'label[for="ip_on"]',
  '.ip_check .switch_btn',
  '.switch_btn',
  'span.switch',
];

async function findIpSecurityInput(page: Page) {
  for (const sel of IP_SECURITY_INPUT_SELECTORS) {
    const loc = page.locator(sel).first();
    if ((await loc.count().catch(() => 0)) > 0) return loc;
  }
  return null;
}

async function isNaverIpSecurityOn(page: Page): Promise<boolean | null> {
  const ipInput = await findIpSecurityInput(page);
  if (ipInput) return ipInput.isChecked().catch(() => null);

  // 입력 요소가 없어도 스위치 UI만 보이면 evaluate로 한 번 더 확인
  const hasSwitchUi =
    (await page.locator('.ip_check .switch_btn, label.switch_btn').count().catch(() => 0)) > 0;
  if (!hasSwitchUi) return null;

  return page
    .evaluate(() => {
      const el = document.querySelector('#switch, #ip_on') as HTMLInputElement | null;
      return el ? el.checked : null;
    })
    .catch(() => null);
}

async function findVisibleIpSecuritySwitch(page: Page) {
  for (const sel of IP_SECURITY_SWITCH_SELECTORS) {
    const loc = page.locator(sel).first();
    if ((await loc.count().catch(() => 0)) === 0) continue;
    if (await loc.isVisible().catch(() => false)) return loc;
  }
  return null;
}

async function clickIpSecurityOffWithMouse(page: Page): Promise<boolean> {
  if (await isNaverAuthChallengePage(page)) return false;

  const switchLoc = await findVisibleIpSecuritySwitch(page);
  if (switchLoc) {
    try {
      await humanClickLocator(page, switchLoc);
    } catch {
      /* bbox 실패 시 좌표 클릭으로 폴백 */
    }
    await sleep(randomBetween(220, 480));
    if ((await isNaverIpSecurityOn(page)) === false) return true;
  }

  for (const sel of ['label[for="switch"]', '.ip_check .switch_btn', '#label_ip_on', 'label[for="ip_on"]', '.switch_btn']) {
    const loc = page.locator(sel).first();
    const box = await loc.boundingBox().catch(() => null);
    if (!box || box.width <= 0 || box.height <= 0) continue;
    const cx = box.x + box.width / 2 + randomBetween(-2, 2);
    const cy = box.y + box.height / 2 + randomBetween(-2, 2);
    await humanMouseMove(page, cx, cy);
    await sleep(randomBetween(100, 250));
    if (await isNaverAuthChallengePage(page)) return false;
    await page.mouse.click(cx, cy);
    await sleep(randomBetween(220, 480));
    if ((await isNaverIpSecurityOn(page)) === false) return true;
  }

  return false;
}

/** nidlogin IP보안 — 모뎀·프록시 환경에서는 OFF(슬라이드 클릭) 필요. JS 폴백 없이 마우스만. */
export async function ensureNaverIpSecurityOff(page: Page): Promise<void> {
  if (!page.url().includes('nidlogin')) return;
  if (await isNaverAuthChallengePage(page)) return;
  await ensureNaverLoginIdPhoneTab(page);

  const ipState = await isNaverIpSecurityOn(page);
  if (ipState === null) return;
  if (ipState === false) return;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (await isNaverAuthChallengePage(page)) return;
    if ((await isNaverIpSecurityOn(page)) === false) return;
    await clickIpSecurityOffWithMouse(page);
  }

  if ((await isNaverIpSecurityOn(page)) === true) {
    await logOperation({
      level: 'warn',
      message: '[login] IP보안 OFF 실패 — 슬라이드(#switch / #label_ip_on) 여전히 ON (마우스 3회 시도)',
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
  if (await isNaverAuthChallengePage(page)) return;
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

  if (await isNaverAuthChallengePage(page)) return;
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
  if (await isNaverAuthChallengePage(page)) return false;

  await ensureNaverLoginIdPhoneTab(page);
  if (await isNaverAuthChallengePage(page)) return false;
  await ensureNaverIpSecurityOff(page);
  if (accountId) {
    await ensureNaverLoginCredentialsForCaptcha(page, accountId, { fast: true }).catch(() => {});
  }
  await humanSleep(350, 700);
  if (await isNaverAuthChallengePage(page)) return false;
  try {
    await clickNaverLoginButton(page);
  } catch {
    return false;
  }
  await page
    .waitForURL((u) => !u.href.includes('nidlogin'), { timeout: 25_000 })
    .catch(() => {});
  return !page.url().includes('nidlogin');
}

/** 로그인 버튼 — 활성(off 제거) 대기·클릭 검증·재시도. 2단계 인증 화면에서는 클릭 금지. */
export async function clickNaverLoginButton(page: Page): Promise<void> {
  if (await isNaverAuthChallengePage(page)) return;
  await ensureNaverLoginIdPhoneTab(page);
  if (await isNaverAuthChallengePage(page)) return;
  await ensureNaverIpSecurityOff(page);
  if (await isNaverAuthChallengePage(page)) return;

  let lastErr: Error | undefined;

  for (let round = 0; round < 4; round += 1) {
    if (await isNaverAuthChallengePage(page)) return;

    let btn = await waitForNaverLoginButtonReady(page, round === 0 ? 8000 : 3000);
    if (!btn) btn = await findNaverLoginButton(page);
    if (!btn) break;

    const ready = await isNaverLoginButtonReady(btn);
    if (!ready && !(round >= 2 && (await canForceAttemptLoginButton(page, btn)))) {
      await sleep(randomBetween(200, 450));
      continue;
    }

    try {
      await clickNaverLoginButtonOnce(page, btn, round);
    } catch (err) {
      lastErr = err as Error;
      await sleep(randomBetween(250, 500));
      continue;
    }

    if (await didNaverLoginSubmitStart(page)) return;

    lastErr = new Error('NAVER_LOGIN_BTN_CLICK_NO_SUBMIT');
    await sleep(randomBetween(300, 600));
  }

  if (await didNaverLoginSubmitStart(page)) return;
  if (await isNaverLoginCaptchaOnPage(page)) return;

  const fallbackBtn = await findNaverLoginButton(page);
  if (fallbackBtn && (await tryNaverLoginSubmitFallback(page, fallbackBtn))) return;

  const inlineErr = await readNaverLoginInlineError(page);
  if (inlineErr) {
    throw new Error(
      /아이디|비밀번호|password/i.test(inlineErr)
        ? 'NAVER_LOGIN_CREDENTIALS'
        : `NAVER_LOGIN_FAILED:${inlineErr.slice(0, 120)}`,
    );
  }

  if (await isNaverLoginCaptchaOnPage(page)) return;

  await logOperation({
    level: 'warn',
    message: `[login] 로그인 버튼 클릭 실패 — ${lastErr?.message ?? 'NAVER_LOGIN_BTN_NOT_FOUND'}`,
  }).catch(() => {});

  throw lastErr ?? new Error('NAVER_LOGIN_BTN_NOT_FOUND');
}
