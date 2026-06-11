import type { BrowserContext, Page } from 'playwright';

import { askClaudeVision } from './anthropic-client.js';
import { shouldAutoSolveCaptchaVision } from './human-engine-policy.js';
import { logOperation } from './log-emitter.js';
import { humanSleep } from '../modules/human-engine/typing.js';
import { humanClickLocator } from '../modules/human-engine/mouse.js';
import { randomBetween, sleep } from './utils.js';

const VISION_MODEL = 'claude-sonnet-4-6';
const MAX_ATTEMPTS = 3;

export type CaptchaVisionResult = 'disabled' | 'not_visible' | 'solved' | 'failed';

export interface NaverCaptchaVisionContext {
  accountId?: string;
  humaJobId?: string;
  workspace?: string | null;
  jobType?: string;
  accountLabel?: string;
  /** 답 입력 후 제출(로그인·발행 등) */
  resubmit?: () => Promise<void>;
}

const CAPTCHA_ROOT_SELECTORS = [
  '#captcha',
  '#cptch',
  '.captcha_wrap',
  '[id*="captcha"]',
  '.captcha',
];

const CAPTCHA_IMAGE_SELECTORS = [
  '#captchaimg',
  '#captcha img',
  '.captcha img',
  '[class*="captcha"] img',
];

const QUESTION_SELECTORS = [
  '#captcha .captcha_message',
  '#captcha p',
  '.captcha_info',
  '[class*="captcha"] p',
  'label[for*="captcha"]',
];

const ANSWER_INPUT_SELECTORS = [
  '#captcha input',
  '#cptch input',
  '.captcha input[type="text"]',
  '.captcha input[type="tel"]',
  '.captcha input[type="number"]',
  'input[name*="captcha"]',
  'input[id*="captcha"]',
];

export function pickNaverCaptchaPage(context: BrowserContext): Page | undefined {
  const pages = context.pages().filter((p) => !p.isClosed());
  return (
    pages.find((p) => p.url().includes('nid.naver.com')) ??
    pages.find((p) => p.url().includes('naver.com')) ??
    pages.at(-1)
  );
}

export async function isNaverCaptchaVisible(page: Page): Promise<boolean> {
  const url = page.url().toLowerCase();
  if (url.includes('captcha') || url.includes('challenge')) return true;

  for (const sel of CAPTCHA_ROOT_SELECTORS) {
    const loc = page.locator(sel).first();
    if (await loc.isVisible().catch(() => false)) return true;
  }

  const iframeCount = await page.locator('iframe[src*="captcha"]').count().catch(() => 0);
  return iframeCount > 0;
}

async function locateCaptchaRoot(page: Page) {
  for (const sel of CAPTCHA_ROOT_SELECTORS) {
    const loc = page.locator(sel).first();
    if (await loc.isVisible().catch(() => false)) return loc;
  }
  return page.locator('body');
}

async function captureCaptchaImageBase64(page: Page): Promise<{ base64: string; mediaType: 'image/png' | 'image/jpeg' } | null> {
  for (const sel of CAPTCHA_IMAGE_SELECTORS) {
    const img = page.locator(sel).first();
    if (await img.isVisible().catch(() => false)) {
      const buf = await img.screenshot({ type: 'png' }).catch(() => null);
      if (buf?.length) return { base64: buf.toString('base64'), mediaType: 'image/png' };
    }
  }

  const root = await locateCaptchaRoot(page);
  const buf = await root.screenshot({ type: 'png' }).catch(() => null);
  if (!buf?.length) return null;
  return { base64: buf.toString('base64'), mediaType: 'image/png' };
}

async function readCaptchaQuestion(page: Page): Promise<string> {
  for (const sel of QUESTION_SELECTORS) {
    const text = await page
      .locator(sel)
      .first()
      .textContent({ timeout: 1500 })
      .catch(() => null);
    if (text?.trim()) return text.trim();
  }

  const root = await locateCaptchaRoot(page);
  const text = await root.textContent({ timeout: 1500 }).catch(() => '');
  const lines = (text ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 3 && /[가-힣?？]/.test(l));
  return lines[0] ?? '이미지의 질문에 맞는 답을 구하세요.';
}

async function refreshCaptchaImage(page: Page): Promise<void> {
  const refreshSelectors = [
    '#captcha_reload',
    '#captcha_refresh',
    'button[aria-label*="새로고침"]',
    'a.btn_refresh',
    '.captcha_refresh',
    '[class*="refresh"]',
  ];
  for (const sel of refreshSelectors) {
    const btn = page.locator(sel).first();
    if (await btn.isVisible().catch(() => false)) {
      await humanClickLocator(page, btn);
      await sleep(randomBetween(800, 1500));
      return;
    }
  }
}

function parseVisionAnswer(raw: string | null): string | null {
  if (!raw?.trim()) return null;
  const trimmed = raw.trim();
  try {
    const json = JSON.parse(trimmed) as { answer?: string };
    if (typeof json.answer === 'string' && json.answer.trim()) return json.answer.trim();
  } catch {
    /* plain text */
  }
  const jsonMatch = trimmed.match(/"answer"\s*:\s*"([^"]+)"/);
  if (jsonMatch?.[1]) return jsonMatch[1].trim();
  const digitMatch = trimmed.match(/\d+/);
  if (digitMatch) return digitMatch[0];
  const alnum = trimmed.replace(/[^0-9a-zA-Z가-힣]/g, '');
  return alnum.length ? alnum.slice(0, 32) : null;
}

async function solveCaptchaWithVision(
  imageBase64: string,
  mediaType: 'image/png' | 'image/jpeg',
  question: string,
): Promise<string | null> {
  const system = `You solve Naver Korean login CAPTCHA images.
Return ONLY JSON: {"answer":"..."} with no markdown.
Rules:
- Receipt "총 몇 개" questions: sum the quantity(개수) column only; ignore price rows and promotional lines like "3+1 행사".
- Use digits only when the answer is numeric.
- If multiple digit boxes are implied, return all digits without spaces (e.g. 7 or 007).`;

  const raw = await askClaudeVision({
    model: VISION_MODEL,
    system,
    question,
    imageBase64,
    mediaType,
    max_tokens: 128,
  });
  return parseVisionAnswer(raw);
}

async function fillCaptchaAnswer(page: Page, answer: string): Promise<boolean> {
  const inputs = page.locator(ANSWER_INPUT_SELECTORS.join(', '));
  const count = await inputs.count().catch(() => 0);
  if (count === 0) return false;

  const digits = answer.replace(/\D/g, '') || answer;

  if (count === 1) {
    const input = inputs.first();
    await humanClickLocator(page, input);
    await input.fill('');
    await input.type(digits, { delay: randomBetween(80, 160) });
    return true;
  }

  const padded = digits.padStart(count, '0').slice(-count);
  for (let i = 0; i < count; i += 1) {
    const input = inputs.nth(i);
    await humanClickLocator(page, input);
    await input.fill('');
    await input.type(padded[i]!, { delay: randomBetween(80, 160) });
  }
  return true;
}

async function captchaCleared(page: Page): Promise<boolean> {
  if (!(await isNaverCaptchaVisible(page))) return true;
  const errText = await page
    .locator('#err_common, .error_message, .err_msg')
    .first()
    .textContent({ timeout: 1000 })
    .catch(() => null);
  if (errText?.includes('자동입력 방지') || errText?.includes('잘못')) return false;
  return false;
}

/**
 * Claude Vision으로 네이버 CAPTCHA 자동 해결 (최대 3회).
 * 실패 시 'failed' — 호출측에서 VNC hold + Telegram(visionAutoFailed) 처리.
 */
export async function tryAutoSolveNaverCaptcha(
  page: Page,
  ctx: NaverCaptchaVisionContext = {},
): Promise<CaptchaVisionResult> {
  if (!(await shouldAutoSolveCaptchaVision())) return 'disabled';
  if (!(await isNaverCaptchaVisible(page))) return 'not_visible';

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    await logOperation({
      level: 'info',
      message: `[captcha-vision] 자동 해결 시도 ${attempt}/${MAX_ATTEMPTS}`,
      job_id: ctx.humaJobId,
      account_id: ctx.accountId,
    });

    const shot = await captureCaptchaImageBase64(page);
    if (!shot) break;

    const question = await readCaptchaQuestion(page);
    const answer = await solveCaptchaWithVision(shot.base64, shot.mediaType, question);
    if (!answer) {
      await humanSleep(3000, 7000);
      await refreshCaptchaImage(page);
      continue;
    }

    const filled = await fillCaptchaAnswer(page, answer);
    if (!filled) break;

    await humanSleep(1500, 3500);

    if (ctx.resubmit) {
      await ctx.resubmit();
    } else if (page.url().includes('nidlogin')) {
      await humanClickLocator(page, page.locator('#log\\.login'));
    }

    await sleep(randomBetween(2000, 4000));
    if (await captchaCleared(page)) {
      await logOperation({
        level: 'info',
        message: `[captcha-vision] 자동 해결 성공 (시도 ${attempt})`,
        job_id: ctx.humaJobId,
        account_id: ctx.accountId,
      });
      return 'solved';
    }

    if (attempt < MAX_ATTEMPTS) {
      await humanSleep(3000, 7000);
      await refreshCaptchaImage(page);
    }
  }

  await logOperation({
    level: 'warn',
    message: '[captcha-vision] Vision 3회 실패 — VNC 수동 필요',
    job_id: ctx.humaJobId,
    account_id: ctx.accountId,
  });
  return 'failed';
}
