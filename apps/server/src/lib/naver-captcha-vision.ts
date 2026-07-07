import type { BrowserContext, Locator, Page } from 'playwright';

import { askClaudeVision } from './anthropic-client.js';
import { shouldAutoSolveCaptchaVision } from './human-engine-policy.js';
import {
  clickNaverLoginButton,
  ensureNaverIpSecurityOff,
  ensureNaverLoginCredentialsForCaptcha,
  submitNaverLoginAfterCaptcha,
} from './naver-login-fields.js';
import { isNaverAuthChallengePage } from './naver-auth-challenge.js';
import { logOperation } from './log-emitter.js';
import { humanSleep } from '../modules/human-engine/typing.js';
import {
  humanClickLocator,
  humanClickLocatorFallback,
  humanDragLocatorHorizontal,
} from '../modules/human-engine/mouse.js';
import { randomBetween, sleep } from './utils.js';
import { throwIfNaverAccountProtection } from './naver-account-protection.js';

const VISION_MODEL = 'claude-sonnet-4-6';
const MAX_ATTEMPTS = 3;

export type CaptchaVisionResult = 'disabled' | 'not_visible' | 'solved' | 'failed';

export type CaptchaVisionFailureReason =
  | 'auth_challenge'
  | 'capture_unavailable'
  | 'apply_failed'
  | 'attempts_exhausted'
  | 'error';

export interface CaptchaVisionRun {
  result: CaptchaVisionResult;
  attempts: number;
  failureReason?: CaptchaVisionFailureReason;
}

/** 로그인 poll에서 Vision 선시도 후 hold — worker 중복 Vision 방지 */
export const CAPTCHA_DETECTED_VISION_TRIED = 'CAPTCHA_DETECTED:vision_tried';

export function shouldNotifyVisionAutoFailed(run: CaptchaVisionRun): boolean {
  if (run.result !== 'failed') return false;
  return run.failureReason !== 'auth_challenge';
}

type CaptchaType = 'text' | 'grid' | 'slider';

export interface NaverCaptchaVisionContext {
  accountId?: string;
  humaJobId?: string;
  workspace?: string | null;
  jobType?: string;
  accountLabel?: string;
  resubmit?: () => Promise<void>;
  /** true일 때만 캡차 확인 후 nid 로그인 버튼 자동 클릭 (기본 false — VNC 관리자 수동) */
  autoLoginSubmit?: boolean;
}

interface VisionSolveResult {
  type: CaptchaType;
  answer?: string;
  cells?: number[];
  dragPx?: number;
  dragPercent?: number;
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

const CAPTCHA_ANSWER_INPUT_SELECTORS = [
  '#captcha input[type="text"]',
  '#captcha input[type="tel"]',
  '#captcha input[type="number"]',
  '#captcha input[maxlength]',
  '#captcha textarea',
  '#captcha .captcha_input',
  '#cptch input',
  '#cptch textarea',
  'input[name="chptcha"]',
  'input[name="captcha"]',
  'textarea[name="captcha"]',
  '.captcha_box input',
  '.captcha_box textarea',
  '.captcha input[type="text"]',
  '.captcha input[type="tel"]',
  '.captcha input[type="number"]',
  '.captcha textarea',
];

const SLIDER_HANDLE_SELECTORS = [
  '[class*="captcha"] [class*="slider"] [class*="btn"]',
  '[class*="captcha"] [class*="slide"] [class*="btn"]',
  '[class*="captcha"] [class*="handle"]',
  '[class*="captcha"] [class*="drag"]',
  '#captcha [class*="slider"]',
  '#captcha .btn_slide',
  '#captcha_slide_btn',
  '.captcha_slider_button',
  '[class*="slider_btn"]',
  '[class*="slide_btn"]',
];

const SLIDER_TRACK_SELECTORS = [
  '[class*="captcha"] [class*="slider"]',
  '[class*="captcha"] [class*="track"]',
  '#captcha [class*="bar"]',
  '.captcha_slider',
];

const GRID_CELL_SELECTORS = [
  '#captcha ul li',
  '#captcha [class*="img_list"] li',
  '#captcha [class*="image"] li',
  '[class*="captcha"] [class*="list"] li',
  '[class*="captcha"] [class*="grid"] > *',
  '[class*="captcha"] [class*="item"]',
  '[class*="captcha"] [class*="cell"]',
  '#captcha [role="button"]',
  '[class*="captcha"] button[class*="img"]',
];

const CONFIRM_SELECTORS = [
  '#captcha_confirm',
  'a#captcha_confirm',
  '#captcha .btn_confirm',
  '#captcha a.btn_confirm',
  '#captcha button.btn_confirm',
  '#captcha button:has-text("확인")',
  '[class*="captcha"] [class*="confirm"]',
  '[class*="captcha"] button[type="submit"]',
];

import { pickNaverLoginCaptchaPage } from './naver-login-session.js';
import {
  captureAllCaptchaReceiptImagesPng,
  captureCaptchaRegionPng,
  captureFullCaptchaImagePng,
  waitForCaptchaUiStable,
} from './naver-captcha-capture.js';
import {
  buildReceiptCaptchaVisionSystemPrompt,
  buildReceiptCaptchaVisionUserPrompt,
  normalizeCaptchaTextAnswer,
} from './naver-captcha-receipt-prompt.js';

/** CAPTCHA·비번 재입력 대상 — ID/전화번호 탭 우선(QR 중복 탭 제외) */
export async function pickNaverCaptchaPage(context: BrowserContext): Promise<Page | undefined> {
  return pickNaverLoginCaptchaPage(context);
}

/** 보이는 캡차 루트 안에 실제 챌린지(입력·이미지·슬라이더·그리드)가 있을 때만 */
async function locateActiveCaptchaRoot(page: Page): Promise<Locator | null> {
  for (const sel of CAPTCHA_ROOT_SELECTORS) {
    const loc = page.locator(sel).first();
    if (!(await loc.isVisible({ timeout: 300 }).catch(() => false))) continue;

    const inputs = loc.locator(
      'input[type="text"], input[type="tel"], input[type="number"], input[maxlength], textarea',
    );
    const inputCount = await inputs.count().catch(() => 0);
    for (let i = 0; i < inputCount; i += 1) {
      const input = inputs.nth(i);
      if (!(await input.isVisible().catch(() => false))) continue;
      const id = (await input.getAttribute('id').catch(() => null)) ?? '';
      const name = (await input.getAttribute('name').catch(() => null)) ?? '';
      if (id === 'id' || id === 'pw' || name === 'id' || name === 'pw') continue;
      const box = await input.boundingBox().catch(() => null);
      if (box && box.width > 8 && box.height > 8) return loc;
    }

    const img = loc.locator('#captchaimg, img').first();
    if (await img.isVisible({ timeout: 200 }).catch(() => false)) {
      const box = await img.boundingBox().catch(() => null);
      if (box && box.width > 24 && box.height > 24) return loc;
    }

    const slider = loc.locator('[class*="slider"], [class*="slide"], #captcha_slide_btn').first();
    if (await slider.isVisible({ timeout: 200 }).catch(() => false)) {
      const box = await slider.boundingBox().catch(() => null);
      if (box && box.width > 16 && box.height > 16) return loc;
    }

    const gridCount = await loc.locator('ul li, [role="button"]').count().catch(() => 0);
    if (gridCount >= 4) return loc;
  }
  return null;
}

export async function isNaverCaptchaVisible(page: Page): Promise<boolean> {
  const url = page.url().toLowerCase();
  if (url.includes('nid') && (url.includes('/captcha') || url.includes('challenge'))) return true;

  if (await locateActiveCaptchaRoot(page)) return true;

  if (await page.locator('iframe[src*="captcha"]').first().isVisible({ timeout: 250 }).catch(() => false)) {
    return true;
  }

  return false;
}

/** 캡차 확인 클릭 후 DOM 잔여(#captcha 빈 껍데기)와 실제 챌린지 구분 */
async function waitForCaptchaCleared(page: Page, timeoutMs = 10_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await isNaverCaptchaVisible(page))) return true;
    await sleep(350);
  }
  return !(await isNaverCaptchaVisible(page));
}

export async function isNaverLoginPendingAfterCaptcha(page: Page): Promise<boolean> {
  if (!page.url().includes('nidlogin')) return false;
  if (await isNaverCaptchaVisible(page)) return false;
  if (await isNaverAuthChallengePage(page)) return false;
  return true;
}

async function locateCaptchaRoot(page: Page): Promise<Locator> {
  for (const sel of CAPTCHA_ROOT_SELECTORS) {
    const loc = page.locator(sel).first();
    if (await loc.isVisible().catch(() => false)) return loc;
  }
  return page.locator('body');
}

async function findGridCells(root: Locator): Promise<Locator[]> {
  for (const sel of GRID_CELL_SELECTORS) {
    const loc = root.locator(sel);
    const count = await loc.count().catch(() => 0);
    if (count >= 4 && count <= 16) {
      return Array.from({ length: count }, (_, i) => loc.nth(i));
    }
  }
  return [];
}

async function findSliderHandle(page: Page, root: Locator): Promise<Locator | null> {
  for (const sel of SLIDER_HANDLE_SELECTORS) {
    const loc = page.locator(sel).first();
    if (await loc.isVisible().catch(() => false)) return loc;
  }
  const inRoot = root.locator('[class*="btn"], [class*="handle"], [class*="slider"]').first();
  if (await inRoot.isVisible().catch(() => false)) return inRoot;
  return null;
}

async function getSliderTrackWidth(page: Page, root: Locator): Promise<number> {
  for (const sel of SLIDER_TRACK_SELECTORS) {
    const loc = page.locator(sel).first();
    const box = await loc.boundingBox().catch(() => null);
    if (box && box.width > 40) return box.width;
  }
  const rootBox = await root.boundingBox().catch(() => null);
  return rootBox?.width ?? 300;
}

async function detectCaptchaType(page: Page): Promise<CaptchaType> {
  const root = await locateCaptchaRoot(page);

  const handle = await findSliderHandle(page, root);
  if (handle) {
    const rootText = (await root.textContent().catch(() => '')) ?? '';
    if (/밀어|드래그|슬라이드|퍼즐|맞춰|이동/.test(rootText)) return 'slider';
    const trackW = await getSliderTrackWidth(page, root);
    if (trackW > 80) return 'slider';
  }

  const cells = await findGridCells(root);
  if (cells.length >= 4) return 'grid';

  const inputInRoot = await root
    .locator(
      'input[type="text"], input[type="tel"], input[type="number"], textarea, input[maxlength]',
    )
    .count()
    .catch(() => 0);
  if (inputInRoot > 0) return 'text';

  const globalInputs = await page
    .locator(CAPTCHA_ANSWER_INPUT_SELECTORS.join(', '))
    .count()
    .catch(() => 0);
  if (globalInputs > 0) return 'text';

  if (cells.length === 0) {
    const imgTiles = await root.locator('img').count().catch(() => 0);
    if (imgTiles >= 4) return 'grid';
  }

  return 'text';
}

function isReceiptLikeCaptcha(question: string): boolean {
  return /영수증|잘린|절취|가격|개수|총합|품목|물건|메뉴|용량|ml|빈\s*칸|위치|구매한|가게|마켓|주소|상호|한글|개당|합계|\[\?\]|총\s*몇|결제\s*금액|할인|행사|지점|매장|단가|수량/.test(
    question,
  );
}

type CaptchaVisionImages = Array<{ base64: string; mediaType: 'image/png' | 'image/jpeg' }>;

async function captureCaptchaScreenshot(
  page: Page,
  type: CaptchaType,
  question = '',
): Promise<CaptchaVisionImages | null> {
  await page.bringToFront().catch(() => {});
  await waitForCaptchaUiStable(page);

  const root = await locateActiveCaptchaRoot(page);
  const captureRoot = root ?? (await locateCaptchaRoot(page));

  const toPayload = (bufs: Buffer[]): CaptchaVisionImages =>
    bufs.map((buf) => ({ base64: buf.toString('base64'), mediaType: 'image/png' as const }));

  if (type === 'text' && (isReceiptLikeCaptcha(question) || page.url().includes('nidlogin'))) {
    const receiptImgs = await captureAllCaptchaReceiptImagesPng(page);
    if (receiptImgs.length) return toPayload(receiptImgs.slice(0, 3));

    const region = await captureCaptchaRegionPng(page, captureRoot);
    if (region?.length) return toPayload([region]);
  }

  if (type === 'text') {
    const receiptImgs = await captureAllCaptchaReceiptImagesPng(page);
    if (receiptImgs.length) return toPayload(receiptImgs.slice(0, 3));

    for (const sel of CAPTCHA_IMAGE_SELECTORS) {
      const img = page.locator(sel).first();
      if (await img.isVisible().catch(() => false)) {
        const buf = await img.screenshot({ type: 'png', animations: 'disabled' }).catch(() => null);
        if (buf?.length) return toPayload([buf]);
      }
    }
  }

  const region = await captureCaptchaRegionPng(page, captureRoot);
  if (region?.length) return toPayload([region]);

  const buf = await captureRoot.screenshot({ type: 'png', animations: 'disabled' }).catch(() => null);
  if (!buf?.length) return null;
  return toPayload([buf]);
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

async function safeHumanClick(page: Page, locator: Locator): Promise<void> {
  if (await isNaverAuthChallengePage(page)) return;
  await locator.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
  if (!(await humanClickLocatorFallback(page, locator, [90, 260]))) {
    throw new Error('CAPTCHA_CLICK_NO_BBOX');
  }
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
      await safeHumanClick(page, btn);
      await sleep(randomBetween(800, 1500));
      return;
    }
  }
}

function extractJsonObject(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim();
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    if (parsed && typeof parsed === 'object') return parsed;
  } catch {
    /* fall through */
  }
  const match = trimmed.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function parseVisionSolveResult(
  raw: string | null,
  expectedType: CaptchaType,
  question = '',
): VisionSolveResult | null {
  if (!raw?.trim()) return null;
  const json = extractJsonObject(raw);
  if (json) {
    const type = (json.type as CaptchaType) ?? expectedType;
    const cells = Array.isArray(json.cells)
      ? json.cells.map((c) => Number(c)).filter((n) => Number.isFinite(n) && n >= 1)
      : undefined;
    const dragPx = json.dragPx != null ? Number(json.dragPx) : undefined;
    const dragPercent = json.dragPercent != null ? Number(json.dragPercent) : undefined;
    const answerRaw =
      typeof json.answer === 'string'
        ? json.answer.trim()
        : typeof json.answer === 'number'
          ? String(json.answer)
          : undefined;

    if (json.insufficient === true || json.insufficient === 'true') return null;
    if (typeof json.missing === 'string' && json.missing.trim() && !answerRaw) return null;

    const answer = answerRaw ? normalizeCaptchaTextAnswer(answerRaw, question) : undefined;

    if (type === 'grid' && cells?.length) return { type: 'grid', cells };
    if (type === 'slider' && (dragPx != null || dragPercent != null)) {
      return { type: 'slider', dragPx, dragPercent };
    }
    if (answer) return { type: 'text', answer };
  }

  if (expectedType === 'text') {
    const asksKoreanText =
      (/이름|한글|가게|메뉴|품목|물건|상호|무엇입니까|무엇인가요|입력|빈\s*칸|위치/.test(question) &&
        !/가격은\s*얼마|몇\s*개|총합|합계|개당\s*가격|한\s*개\s*당\s*가격|용량|ml/.test(question)) ||
      /\[\?\]/.test(question);
    const asksNumber =
      /가격|얼마|몇\s*개|총|합계|개당|담당|숫자|원|용량|ml|하나\s*당/.test(question) && !asksKoreanText;

    if (asksKoreanText) {
      const hangul = raw.match(/[가-힣]{2,}/)?.[0];
      if (hangul) return { type: 'text', answer: normalizeCaptchaTextAnswer(hangul, question) };
      return null;
    }

    if (asksNumber) {
      const digitMatch = raw.match(/\d+/);
      if (digitMatch) return { type: 'text', answer: normalizeCaptchaTextAnswer(digitMatch[0], question) };
    }

    const hangul = raw.match(/[가-힣]{2,}/)?.[0];
    if (hangul) return { type: 'text', answer: normalizeCaptchaTextAnswer(hangul, question) };
    const alnum = raw.replace(/[^0-9a-zA-Z가-힣]/g, '');
    if (alnum.length) {
      return { type: 'text', answer: normalizeCaptchaTextAnswer(alnum.slice(0, 32), question) };
    }
  }
  return null;
}

async function solveCaptchaWithVision(
  images: CaptchaVisionImages,
  question: string,
  type: CaptchaType,
  meta: { cellCount?: number; trackWidthPx?: number },
): Promise<VisionSolveResult | null> {
  if (!images.length) return null;

  let system: string;
  let prompt: string;
  let maxTokens: number;

  if (type === 'grid') {
    system = `You solve Naver image-grid CAPTCHA. Return ONLY JSON, no markdown.
Format: {"type":"grid","cells":[1,3,5]}
- cells: 1-based indices left-to-right, top-to-bottom (${meta.cellCount ?? '?'} cells total).
- Click ALL tiles matching the Korean instruction.
- Receipt/torn-receipt tiles: match the EXACT store name, menu, or item category asked — not a similar word from another tile.`;
    prompt = `Question: ${question}\nGrid has ${meta.cellCount ?? 'unknown'} clickable tiles numbered 1..N row-major.`;
    maxTokens = 192;
  } else if (type === 'slider') {
    system = `You solve Naver slide-puzzle CAPTCHA. Return ONLY JSON, no markdown.
Format: {"type":"slider","dragPx":127} OR {"type":"slider","dragPercent":0.62}
- dragPx: pixels to drag the slider handle RIGHT to align the puzzle piece.
- dragPercent: fraction of track width (0-1) if exact pixels unclear.
- Slider track width ≈ ${meta.trackWidthPx ?? 300}px.`;
    prompt = `Question: ${question}\nFind how far to drag the slider handle horizontally to complete the puzzle.`;
    maxTokens = 128;
  } else {
    const receiptLike = isReceiptLikeCaptcha(question);
    if (receiptLike) {
      system = buildReceiptCaptchaVisionSystemPrompt();
      prompt = buildReceiptCaptchaVisionUserPrompt(question, images.length);
      maxTokens = 1024;
    } else {
      system = `You solve Naver Korean login CAPTCHA images. Return ONLY JSON: {"type":"text","answer":"..."}
Rules:
- Store address blank [?]: fill missing Korean road name from receipt address line.
- Product capacity ml: extract number from parentheses e.g. "(용량 100ml)" → "100".
- Torn receipt: stitch vertical fragments top→bottom; match question to correct column or product line.
- Korean names: copy EXACT from image (가-힣).
- Digits only when question asks for number/count/amount/capacity.`;
      prompt = `Question: ${question}\nRead the full captcha image including all receipt fragments.`;
      maxTokens = 384;
    }
  }

  const raw = await askClaudeVision({
    model: VISION_MODEL,
    system,
    question: prompt,
    images,
    max_tokens: maxTokens,
  });
  return parseVisionSolveResult(raw, type, question);
}

function splitAnswerForInputs(answer: string, inputCount: number): string[] {
  const trimmed = answer.trim();
  if (inputCount <= 1) return [trimmed];
  if (/^\d+$/.test(trimmed)) {
    const padded = trimmed.padStart(inputCount, '0').slice(-inputCount);
    return [...padded];
  }
  const chars = [...trimmed.replace(/\s/g, '')];
  if (chars.length <= inputCount) return chars;
  return chars.slice(0, inputCount);
}

async function humanTypeCaptchaAnswer(page: Page, input: Locator, text: string): Promise<void> {
  if (await isNaverAuthChallengePage(page)) return;
  await input.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
  const box = await input.boundingBox().catch(() => null);
  if (box && box.width > 0 && box.height > 0) {
    await humanClickLocator(page, input, undefined, [120, 280], { login: true });
  } else {
    await input.focus().catch(() => {});
    await sleep(randomBetween(100, 300));
  }

  const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
  await page.keyboard.press(`${mod}+a`).catch(() => {});
  await page.keyboard.press('Backspace').catch(() => {});
  await sleep(randomBetween(80, 160));

  if (/^\d+$/.test(text)) {
    await page.keyboard.insertText(text);
    return;
  }

  if (/[가-힣]/.test(text)) {
    await page.keyboard.insertText(text);
    return;
  }

  for (const ch of text) {
    await page.keyboard.type(ch, { delay: randomBetween(80, 160) });
  }
}

/** CAPTCHA 영역 내 보이는 입력칸만 (로그인 #id·#pw 제외). */
async function getVisibleCaptchaInputs(page: Page): Promise<Locator[]> {
  const activeRoot = await locateActiveCaptchaRoot(page);
  const candidates = activeRoot
    ? [
        activeRoot.locator(
          'input[type="text"], input[type="tel"], input[type="number"], input[maxlength], textarea',
        ),
      ]
    : [page.locator(CAPTCHA_ANSWER_INPUT_SELECTORS.join(', '))];

  const seen = new Set<string>();
  const visible: Locator[] = [];

  for (const group of candidates) {
    const count = await group.count().catch(() => 0);
    for (let i = 0; i < count; i += 1) {
      const input = group.nth(i);
      if (!(await input.isVisible().catch(() => false))) continue;

      const id = (await input.getAttribute('id').catch(() => null)) ?? '';
      const name = (await input.getAttribute('name').catch(() => null)) ?? '';
      if (id === 'id' || id === 'pw' || name === 'id' || name === 'pw') continue;

      const key = `${id}:${name}:${i}`;
      if (seen.has(key)) continue;
      seen.add(key);
      visible.push(input);
    }
    if (visible.length > 0) break;
  }

  return visible;
}

async function fillCaptchaAnswer(page: Page, answer: string): Promise<boolean> {
  if (await isNaverAuthChallengePage(page)) return false;
  const inputs = await getVisibleCaptchaInputs(page);
  if (inputs.length === 0) return false;

  const parts = splitAnswerForInputs(answer, inputs.length);
  for (let i = 0; i < inputs.length; i += 1) {
    const part = parts[i] ?? parts[0] ?? answer;
    if (!part) continue;
    await humanTypeCaptchaAnswer(page, inputs[i]!, part);
    if (i < inputs.length - 1) await humanSleep(120, 350);
  }
  return true;
}

async function applyGridClicks(page: Page, cells: Locator[], indices: number[]): Promise<boolean> {
  if (await isNaverAuthChallengePage(page)) return false;
  if (!indices.length) return false;
  for (const idx of indices) {
    const cell = cells[idx - 1];
    if (!cell) continue;
    await safeHumanClick(page, cell);
    await humanSleep(350, 900);
  }
  return true;
}

async function applySliderDrag(
  page: Page,
  root: Locator,
  result: VisionSolveResult,
): Promise<boolean> {
  if (await isNaverAuthChallengePage(page)) return false;
  const handle = await findSliderHandle(page, root);
  if (!handle) return false;

  const trackW = await getSliderTrackWidth(page, root);
  let offsetX = result.dragPx ?? 0;
  if (result.dragPercent != null && Number.isFinite(result.dragPercent)) {
    offsetX = Math.round(trackW * Math.max(0, Math.min(1, result.dragPercent)));
  }
  if (offsetX < 8) return false;

  const maxDrag = Math.max(trackW - 20, offsetX);
  offsetX = Math.min(offsetX, maxDrag);

  await humanDragLocatorHorizontal(page, handle, offsetX);
  await humanSleep(500, 1200);
  return true;
}

async function clickCaptchaConfirm(page: Page): Promise<boolean> {
  for (const sel of CONFIRM_SELECTORS) {
    const btn = page.locator(sel).first();
    if (!(await btn.isVisible().catch(() => false))) continue;
    const box = await btn.boundingBox().catch(() => null);
    if (!box || box.width <= 0 || box.height <= 0) continue;
    await safeHumanClick(page, btn);
    await sleep(randomBetween(400, 900));
    return true;
  }
  return false;
}

async function submitCaptcha(
  page: Page,
  ctx: NaverCaptchaVisionContext,
  options?: { refillPassword?: boolean },
): Promise<void> {
  if (await isNaverAuthChallengePage(page)) return;

  if (page.url().includes('nidlogin')) {
    await ensureNaverIpSecurityOff(page);
  }

  if (await isNaverAuthChallengePage(page)) return;

  if (options?.refillPassword === true && ctx.accountId && page.url().includes('nidlogin')) {
    await ensureNaverLoginCredentialsForCaptcha(page, ctx.accountId, { fast: true });
    await humanSleep(150, 350);
  }

  const confirmed = await clickCaptchaConfirm(page);
  if (!confirmed) {
    // nidlogin 캡차는 별도 확인 버튼이 없다 — 로그인 버튼 마우스 클릭
    if (page.url().includes('nidlogin') && !(await isNaverAuthChallengePage(page))) {
      await clickNaverLoginButton(page, { skipIpSecurity: true, credentialsReady: true });
      await sleep(randomBetween(250, 500));
    } else if (!page.url().includes('nidlogin')) {
      await page.keyboard.press('Enter').catch(() => {});
      await sleep(randomBetween(350, 700));
    }
  }

  if (ctx.autoLoginSubmit === true) {
    if (ctx.resubmit) {
      await ctx.resubmit();
    } else if (page.url().includes('nidlogin') && !(await isNaverAuthChallengePage(page))) {
      await clickNaverLoginButton(page, { skipIpSecurity: true, credentialsReady: true });
    }
  }
}

/**
 * 웹 대시보드에서 받은 수동 정답 — VNC 한글 IME 없이 Playwright insertText 로
 * 캡차 입력칸에 직접 주입 후 제출한다 (한글·숫자 모두 IME 불필요).
 */
export async function applyManualCaptchaAnswer(
  page: Page,
  answer: string,
  ctx: NaverCaptchaVisionContext = {},
): Promise<{ filled: boolean; submitted: boolean; cleared: boolean; pending_login: boolean }> {
  if (await isNaverAuthChallengePage(page)) {
    return {
      filled: false,
      submitted: false,
      cleared: !(await isNaverCaptchaVisible(page)),
      pending_login: true,
    };
  }

  if (page.url().includes('nidlogin')) {
    await ensureNaverIpSecurityOff(page);
  }

  if (await isNaverAuthChallengePage(page)) {
    return {
      filled: true,
      submitted: false,
      cleared: !(await isNaverCaptchaVisible(page)),
      pending_login: true,
    };
  }

  // ① 정답칸 마우스 이동·클릭 후 정답 입력
  const filled = await fillCaptchaAnswer(page, answer);
  if (!filled) return { filled: false, submitted: false, cleared: false, pending_login: false };

  await humanSleep(250, 600);

  let cleared: boolean;
  let pending_login: boolean;

  if (page.url().includes('nidlogin')) {
    if (await isNaverAuthChallengePage(page)) {
      cleared = !(await isNaverCaptchaVisible(page));
      pending_login = true;
    } else {
      const loggedIn = await submitNaverLoginAfterCaptcha(page, ctx.accountId ?? '');
      await humanSleep(500, 1200);
      if (await isNaverAuthChallengePage(page)) {
        cleared = !(await isNaverCaptchaVisible(page));
        pending_login = true;
      } else {
        cleared = loggedIn || !(await isNaverCaptchaVisible(page));
        pending_login = cleared && !loggedIn;
      }
    }
  } else {
    // 비-nidlogin 챌린지(그리드·슬라이더 등) — 확인 버튼 클릭
    await submitCaptcha(page, ctx, { refillPassword: false });
    cleared = await waitForCaptchaCleared(page, 8_000);
    pending_login = cleared ? await isNaverLoginPendingAfterCaptcha(page) : false;
    if (!cleared && (await isNaverLoginPendingAfterCaptcha(page))) {
      cleared = true;
      pending_login = true;
    }
  }

  return { filled: true, submitted: true, cleared, pending_login };
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

async function applyVisionResult(
  page: Page,
  type: CaptchaType,
  result: VisionSolveResult,
): Promise<boolean> {
  const root = await locateCaptchaRoot(page);

  if (type === 'grid' && result.cells?.length) {
    const cells = await findGridCells(root);
    if (!cells.length) return false;
    return applyGridClicks(page, cells, result.cells);
  }

  if (type === 'slider') {
    return applySliderDrag(page, root, result);
  }

  if (result.answer) {
    return fillCaptchaAnswer(page, result.answer);
  }

  return false;
}

/**
 * Claude Vision으로 네이버 CAPTCHA 자동 해결 (텍스트·그리드 클릭·슬라이드 퍼즐, 최대 3회).
 */
function failedVisionRun(
  attempts: number,
  failureReason: CaptchaVisionFailureReason,
): CaptchaVisionRun {
  return { result: 'failed', attempts, failureReason };
}

export async function tryAutoSolveNaverCaptcha(
  page: Page,
  ctx: NaverCaptchaVisionContext = {},
): Promise<CaptchaVisionRun> {
  if (!(await shouldAutoSolveCaptchaVision())) {
    return { result: 'disabled', attempts: 0 };
  }
  if (!(await isNaverCaptchaVisible(page))) {
    return { result: 'not_visible', attempts: 0 };
  }
  if (await isNaverAuthChallengePage(page)) {
    return failedVisionRun(0, 'auth_challenge');
  }

  if (page.url().includes('nidlogin')) {
    await ensureNaverIpSecurityOff(page);
  }
  if (await isNaverAuthChallengePage(page)) {
    return failedVisionRun(0, 'auth_challenge');
  }

  let attempts = 0;
  let failureReason: CaptchaVisionFailureReason = 'attempts_exhausted';

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      if (await isNaverAuthChallengePage(page)) {
        return failedVisionRun(attempts, 'auth_challenge');
      }

      const captchaType = await detectCaptchaType(page);
      const question = await readCaptchaQuestion(page);

      await waitForCaptchaUiStable(page);

      await logOperation({
        level: 'info',
        message: `[captcha-vision] ${captchaType} 자동 해결 시도 ${attempt}/${MAX_ATTEMPTS}`,
        job_id: ctx.humaJobId,
        account_id: ctx.accountId,
      });

      const shot = await captureCaptchaScreenshot(page, captchaType, question);
      if (!shot?.length) {
        failureReason = 'capture_unavailable';
        break;
      }

      attempts += 1;

      const root = await locateCaptchaRoot(page);
      const cells = captchaType === 'grid' ? await findGridCells(root) : [];
      const trackW = captchaType === 'slider' ? await getSliderTrackWidth(page, root) : undefined;

      const solved = await solveCaptchaWithVision(shot, question, captchaType, {
        cellCount: cells.length || undefined,
        trackWidthPx: trackW,
      });
      if (!solved) {
        await humanSleep(1200, 2500);
        await refreshCaptchaImage(page);
        continue;
      }

      const applied = await applyVisionResult(page, captchaType, solved);
      if (!applied) {
        failureReason = 'apply_failed';
        break;
      }

      await humanSleep(300, 700);
      await submitCaptcha(page, ctx, { refillPassword: true });

      await sleep(randomBetween(800, 1500));
      if (await captchaCleared(page)) {
        await throwIfNaverAccountProtection(page, 'captcha', { closeBrowser: false });
        await logOperation({
          level: 'info',
          message: `[captcha-vision] ${captchaType} 자동 해결 성공 (시도 ${attempt})`,
          job_id: ctx.humaJobId,
          account_id: ctx.accountId,
        });
        return { result: 'solved', attempts };
      }

      if (attempt < MAX_ATTEMPTS) {
        await humanSleep(1200, 2500);
        await refreshCaptchaImage(page);
      }
    } catch (err) {
      failureReason = 'error';
      await logOperation({
        level: 'warn',
        message: `[captcha-vision] 시도 ${attempt} 오류: ${(err as Error).message}`,
        job_id: ctx.humaJobId,
        account_id: ctx.accountId,
      });
      if (attempt < MAX_ATTEMPTS) {
        await humanSleep(1200, 2500);
        await refreshCaptchaImage(page).catch(() => {});
      }
    }
  }

  const logDetail =
    failureReason === 'capture_unavailable'
      ? '캡처 실패'
      : failureReason === 'apply_failed'
        ? '정답 적용 실패'
        : attempts > 0
          ? `${attempts}/${MAX_ATTEMPTS}회 시도 후 미통과`
          : 'Vision 시도 전 중단';

  await logOperation({
    level: 'warn',
    message: `[captcha-vision] Vision 자동 해결 실패 (${logDetail}) — VNC 수동 필요`,
    job_id: ctx.humaJobId,
    account_id: ctx.accountId,
  });
  return failedVisionRun(attempts, failureReason);
}

/** CAPTCHA hold·텔레그램·웹 UI용 PNG — union clip + 원본 이미지 펼침 */
export async function captureNaverCaptchaPng(page: Page): Promise<Buffer | null> {
  const activeRoot = await locateActiveCaptchaRoot(page);
  if (activeRoot) {
    const region = await captureCaptchaRegionPng(page, activeRoot);
    if (region && region.length > 800) return region;
  }

  const isNidLogin = page.url().includes('nidlogin') || page.url().includes('nid.naver.com');
  if (isNidLogin) {
    for (const sel of ['#captcha', '#cptch', '.captcha_wrap']) {
      const captcha = page.locator(sel).first();
      if (!(await captcha.isVisible({ timeout: 500 }).catch(() => false))) continue;
      const region = await captureCaptchaRegionPng(page, captcha);
      if (region && region.length > 1200) return region;
    }
  }

  const fullImg = await captureFullCaptchaImagePng(page);
  if (fullImg && fullImg.length > 400) return fullImg;

  for (const sel of ['#captchaimg', '#captcha img', 'img[id*="captcha"]', 'img[src*="captcha"]']) {
    const img = page.locator(sel).first();
    if (!(await img.isVisible({ timeout: 400 }).catch(() => false))) continue;
    const box = await img.boundingBox().catch(() => null);
    if (!box || box.width < 60 || box.height < 20) continue;
    const buf = await img.screenshot({ type: 'png', animations: 'disabled' }).catch(() => null);
    if (buf && buf.length > 400) return buf;
  }

  if (page.url().includes('nidlogin')) {
    for (const sel of ['#frmNIDLogin', '.login_wrap', '#wrapper', '.login_box']) {
      const panel = page.locator(sel).first();
      if (!(await panel.isVisible({ timeout: 300 }).catch(() => false))) continue;
      const box = await panel.boundingBox().catch(() => null);
      if (!box || box.width < 200 || box.height < 200) continue;
      const buf = await panel.screenshot({ type: 'png', animations: 'disabled' }).catch(() => null);
      if (buf && buf.length > 2000) return buf;
    }
  }

  return page.screenshot({ type: 'png', fullPage: false, animations: 'disabled' }).catch(() => null);
}
