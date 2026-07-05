import type { BrowserContext, Page } from 'playwright';

import { humanClickLocator } from '../modules/human-engine/mouse.js';
import { acquireWorkflowPage } from '../modules/playwright/browser.js';
import { isNaverAuthChallengePage } from './naver-auth-challenge.js';
import { sleep } from './utils.js';

/** ID/전화번호 탭 — QR·일회용 mode 금지 */
export const NAVER_LOGIN_ID_URL = 'https://nid.naver.com/nidlogin.login?mode=form&url=https://www.naver.com/';

export function isNidLoginUrl(url: string): boolean {
  return url.includes('nidlogin') || /nid\.naver\.com\/nidlogin/i.test(url);
}

export function isNaverLoginQrOrOtpUrl(url: string): boolean {
  return /mode=qrcode|mode=otp|mode=onetime|mode=number/i.test(url);
}

/** QR·일회용 탭이 아닌 ID/전화번호 폼 */
export async function isNaverLoginIdTabActive(page: Page): Promise<boolean> {
  if (!isNidLoginUrl(page.url())) return false;
  if (isNaverLoginQrOrOtpUrl(page.url())) return false;

  const idVisible = await page.locator('#id').isVisible({ timeout: 500 }).catch(() => false);
  if (!idVisible) return false;

  const qrPanel = page
    .locator('#qrcode, .qrcode, [class*="qrcode"], [class*="qr_code"], canvas')
    .first();
  if (await qrPanel.isVisible({ timeout: 250 }).catch(() => false)) {
    const pwVisible = await page.locator('#pw').isVisible({ timeout: 200 }).catch(() => false);
    if (!pwVisible) return false;
  }

  return true;
}

async function hasVisibleCaptchaOnPage(page: Page): Promise<boolean> {
  for (const sel of ['#captcha', '#cptch', '.captcha_wrap', '#captchaimg']) {
    if (await page.locator(sel).first().isVisible({ timeout: 250 }).catch(() => false)) return true;
  }
  return false;
}

/** QR코드·일회용 번호 탭 클릭 금지 — ID/전화번호만 유지. 2단계 인증 화면에서는 아무 것도 하지 않음. */
export async function ensureNaverLoginIdPhoneTab(page: Page): Promise<void> {
  if (!isNidLoginUrl(page.url())) return;
  if (await isNaverAuthChallengePage(page)) return;

  if (await isNaverLoginIdTabActive(page)) return;

  const idTabSelectors = [
    'a[href*="mode=form"]',
    'li.tab_list a:has-text("ID/전화번호")',
    'a:has-text("ID/전화번호")',
    'button:has-text("ID/전화번호")',
    '[role="tab"]:has-text("ID/전화번호")',
  ];

  for (const sel of idTabSelectors) {
    if (await isNaverAuthChallengePage(page)) return;
    const tab = page.locator(sel).first();
    if (!(await tab.isVisible({ timeout: 400 }).catch(() => false))) continue;
    const href = (await tab.getAttribute('href').catch(() => null)) ?? '';
    if (/qrcode|otp|onetime|mode=number/i.test(href)) continue;
    await humanClickLocator(page, tab, undefined, [120, 280], { login: true });
    await sleep(450);
    if (await isNaverAuthChallengePage(page)) return;
    if (await isNaverLoginIdTabActive(page)) return;
  }

  if (await isNaverAuthChallengePage(page)) return;
  await page.goto(NAVER_LOGIN_ID_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForSelector('#id', { timeout: 20_000 }).catch(() => {});
  await sleep(300);
}

export async function scoreNaverLoginPageForWorkflow(page: Page): Promise<number> {
  if (!isNidLoginUrl(page.url())) return -100;
  let score = 10;
  if (isNaverLoginQrOrOtpUrl(page.url())) score -= 120;
  if (await isNaverLoginIdTabActive(page)) score += 60;
  if (await page.locator('#id').isVisible({ timeout: 300 }).catch(() => false)) score += 25;
  if (await page.locator('#pw').isVisible({ timeout: 300 }).catch(() => false)) score += 15;
  if (await hasVisibleCaptchaOnPage(page)) score += 45;
  return score;
}

/** nidlogin 중복 탭 — ID/캡차 우선 1개만 남기고 나머지 닫기 */
export async function consolidateNaverLoginTabs(
  context: BrowserContext,
  preferred?: Page,
): Promise<Page | undefined> {
  const nidPages = context.pages().filter((p) => !p.isClosed() && isNidLoginUrl(p.url()));
  if (nidPages.length === 0) return preferred;

  let best = preferred && isNidLoginUrl(preferred.url()) ? preferred : nidPages[0]!;
  let bestScore = await scoreNaverLoginPageForWorkflow(best);

  for (const p of nidPages) {
    if (p === best) continue;
    const score = await scoreNaverLoginPageForWorkflow(p);
    if (score > bestScore) {
      best = p;
      bestScore = score;
    }
  }

  for (const p of nidPages) {
    if (p !== best) await p.close().catch(() => {});
  }

  await best.bringToFront().catch(() => {});
  if (!(await isNaverAuthChallengePage(best))) {
    await ensureNaverLoginIdPhoneTab(best);
  }
  return best;
}

/** 로그인 워크플로우 단일 탭 — 기존 nidlogin 재사용·중복 제거 */
export async function acquireNaverLoginPage(context: BrowserContext): Promise<Page> {
  const kept = await consolidateNaverLoginTabs(context);
  if (kept) return kept;

  const page = await acquireWorkflowPage(context);
  await ensureNaverLoginIdPhoneTab(page).catch(() => {});
  return page;
}

/** CAPTCHA·비번 재입력 대상 nidlogin 탭 선택 */
export async function pickNaverLoginCaptchaPage(context: BrowserContext): Promise<Page | undefined> {
  await consolidateNaverLoginTabs(context);

  const pages = context.pages().filter((p) => !p.isClosed() && isNidLoginUrl(p.url()));
  if (pages.length === 0) {
    return context.pages().find((p) => !p.isClosed() && p.url().includes('naver.com'));
  }

  let best = pages[0]!;
  let bestScore = await scoreNaverLoginPageForWorkflow(best);
  for (const p of pages.slice(1)) {
    const score = await scoreNaverLoginPageForWorkflow(p);
    if (score > bestScore) {
      best = p;
      bestScore = score;
    }
  }

  await best.bringToFront().catch(() => {});
  if (!(await isNaverAuthChallengePage(best))) {
    await ensureNaverLoginIdPhoneTab(best);
  }
  return best;
}
