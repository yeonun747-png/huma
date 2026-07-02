import type { Locator, Page } from 'playwright';

import { supabase } from '../middleware/auth.js';
import { decrypt } from './crypto.js';
import { humanSleep } from '../modules/human-engine/typing.js';
import { humanClickLocator, humanClickAtPoint, humanClickLocatorFallback } from '../modules/human-engine/mouse.js';
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
  'button#log\\.login',
  'button.btn_login.next_step:not(.white)',
  'button.btn_login:not(.white)',
] as const;

const NAVER_LOGIN_BTN_FALLBACK_SELECTORS = ['input.btn_login[type="submit"]', 'button[type="submit"]'] as const;

const NAVER_LOGIN_FOOTER_TEXT = /비밀번호\s*찾기|아이디\s*찾기|회원가입|QR\s*코드|일회용/i;

export interface NaverLoginSubmitSnapshot {
  url: string;
  err: string | null;
  captchaVisible: boolean;
  captchaImg: string | null;
  btnClass: string | null;
}

/** 캡cha 제출 후 — URL·오류·캡cha 이미지 등 실제 변화가 있을 때만 true */
export function naverLoginSubmitStateChanged(
  before: NaverLoginSubmitSnapshot,
  after: NaverLoginSubmitSnapshot,
): boolean {
  if (before.url !== after.url) return true;
  if (before.captchaVisible && !after.captchaVisible) return true;
  if (before.captchaImg && after.captchaImg && before.captchaImg !== after.captchaImg) return true;
  if (after.err && after.err !== before.err) return true;
  if (before.btnClass !== after.btnClass && /\bloading\b|\bsubmitting\b|\bwait\b/i.test(after.btnClass ?? '')) {
    return true;
  }
  return false;
}

async function snapshotNaverLoginSubmitState(page: Page): Promise<NaverLoginSubmitSnapshot> {
  return {
    url: page.url(),
    err: await readNaverLoginInlineError(page),
    captchaVisible: await isNaverLoginCaptchaOnPage(page),
    captchaImg: await page
      .locator('#captcha img, .captcha_wrap img, .captcha_box img, #cptch img')
      .first()
      .getAttribute('src')
      .catch(() => null),
    btnClass: await page.locator('#log\\.login').first().getAttribute('class').catch(() => null),
  };
}

async function isValidNaverLoginSubmitButton(btn: Locator): Promise<boolean> {
  if (!(await btn.isVisible().catch(() => false))) return false;
  if (await btn.isDisabled().catch(() => false)) return false;

  const meta = await btn
    .evaluate((el) => {
      const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
      const value = el instanceof HTMLInputElement ? (el.value ?? '').trim() : '';
      const label = text || value;
      const tag = el.tagName;
      const id = el.id;
      const cls = el.className ?? '';
      const r = el.getBoundingClientRect();
      return { label, tag, id, cls, width: r.width, height: r.height };
    })
    .catch(() => null);
  if (!meta) return false;

  if (meta.tag !== 'BUTTON' && meta.tag !== 'INPUT') return false;
  if (/\bwhite\b/.test(meta.cls)) return false;
  if (NAVER_LOGIN_FOOTER_TEXT.test(meta.label)) return false;
  if (meta.width < 120 || meta.height < 28 || meta.height > 96) return false;

  if (meta.id === 'log.login') return true;
  if (meta.label === '로그인') return true;
  return meta.width >= 180 && meta.height >= 36 && meta.height <= 72;
}

async function findNaverLoginButton(page: Page): Promise<Locator | null> {
  for (const sel of NAVER_LOGIN_BTN_SELECTORS) {
    const btn = page.locator(sel).first();
    if ((await btn.count().catch(() => 0)) === 0) continue;
    if (await isValidNaverLoginSubmitButton(btn)) return btn;
  }

  const roleCount = await page.getByRole('button', { name: '로그인', exact: true }).count().catch(() => 0);
  for (let i = 0; i < roleCount; i += 1) {
    const btn = page.getByRole('button', { name: '로그인', exact: true }).nth(i);
    if (await isValidNaverLoginSubmitButton(btn)) return btn;
  }

  for (const sel of NAVER_LOGIN_BTN_FALLBACK_SELECTORS) {
    const btn = page.locator(sel).first();
    if ((await btn.count().catch(() => 0)) === 0) continue;
    if (await isValidNaverLoginSubmitButton(btn)) return btn;
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

async function didNaverLoginSubmitStart(
  page: Page,
  baseline?: NaverLoginSubmitSnapshot,
): Promise<boolean> {
  const before = baseline ?? (await snapshotNaverLoginSubmitState(page));
  const hadCaptcha = before.captchaVisible;

  const deadline = Date.now() + 3200;
  while (Date.now() < deadline) {
    if (await isNaverAuthChallengePage(page)) return true;
    if (!page.url().includes('nidlogin')) return true;

    const now = await snapshotNaverLoginSubmitState(page);
    if (naverLoginSubmitStateChanged(before, now)) return true;

    // 캡cha 없던 일반 로그인 — 캡cha 등장은 제출 시도로 간주
    if (!hadCaptcha && now.captchaVisible) return true;

    await sleep(200);
  }
  return false;
}

async function tryNaverLoginSubmitFallback(page: Page, btn: Locator): Promise<boolean> {
  for (let i = 0; i < 2; i += 1) {
    const baseline = await snapshotNaverLoginSubmitState(page);
    try {
      await clickNaverLoginButtonWithMouse(page, btn);
    } catch {
      continue;
    }
    if (await didNaverLoginSubmitStart(page, baseline)) return true;
    await sleep(randomBetween(300, 600));
  }
  return false;
}

/** 캡cha 입력칸 포커스 해제 — 로그인 버튼 아래 빈 영역 오클릭 방지 */
async function blurNaverCaptchaInputFocus(page: Page): Promise<void> {
  await page
    .evaluate(() => {
      const active = document.activeElement;
      if (!(active instanceof HTMLElement)) return;
      if (active.closest('#captcha, #cptch, .captcha_wrap, .captcha_box, .captcha')) {
        active.blur();
      }
    })
    .catch(() => {});
}

/** nidlogin 로그인 버튼 — Playwright/JS click 금지, humanClick만 (상단 중앙 — 푸터 쪽 오클릭 방지) */
async function clickNaverLoginButtonWithMouse(page: Page, btn: Locator): Promise<void> {
  await blurNaverCaptchaInputFocus(page);
  await btn.scrollIntoViewIfNeeded({ timeout: 5000, block: 'center' }).catch(() => {});
  await sleep(randomBetween(160, 360));

  const box = await btn.boundingBox().catch(() => null);
  if (!box || box.width <= 0 || box.height <= 0) {
    if (await humanClickLocatorFallback(page, btn, [120, 300])) return;
    throw new Error('NAVER_LOGIN_BTN_NO_BBOX');
  }

  const bandTop = box.height * 0.2;
  const bandHeight = Math.max(10, Math.min(box.height * 0.38, 32));
  const cx = box.x + box.width / 2 + randomBetween(-4, 4);
  const cy = box.y + bandTop + randomBetween(0, Math.max(0, bandHeight - 1));
  await humanClickAtPoint(page, cx, cy, 2, [120, 280]);
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
    await humanClickLocatorFallback(page, switchLoc, [100, 250]);
    await sleep(randomBetween(220, 480));
    if ((await isNaverIpSecurityOn(page)) === false) return true;
  }

  for (const sel of ['label[for="switch"]', '.ip_check .switch_btn', '#label_ip_on', 'label[for="ip_on"]', '.switch_btn']) {
    const loc = page.locator(sel).first();
    const box = await loc.boundingBox().catch(() => null);
    if (!box || box.width <= 0 || box.height <= 0) continue;
    const cx = box.x + box.width / 2 + randomBetween(-2, 2);
    const cy = box.y + box.height / 2 + randomBetween(-2, 2);
    if (await isNaverAuthChallengePage(page)) return false;
    await humanClickAtPoint(page, cx, cy, 2, [100, 250]);
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

/** 로그인 버튼 — 마우스만(humanClickLocator). 활성 대기·제출 검증·재시도. 2단계 인증 화면에서는 클릭 금지. */
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

    const submitBaseline = await snapshotNaverLoginSubmitState(page);

    try {
      await clickNaverLoginButtonWithMouse(page, btn);
    } catch (err) {
      lastErr = err as Error;
      await sleep(randomBetween(250, 500));
      continue;
    }

    if (await didNaverLoginSubmitStart(page, submitBaseline)) return;

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
