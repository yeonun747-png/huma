import type { BrowserContext, Locator, Page } from 'playwright';

import { askClaudeVision } from './anthropic-client.js';
import { shouldAutoSolveCaptchaVision } from './human-engine-policy.js';
import {
  clickNaverLoginButton,
  ensureNaverLoginCredentialsForCaptcha,
} from './naver-login-fields.js';
import { logOperation } from './log-emitter.js';
import { humanSleep } from '../modules/human-engine/typing.js';
import {
  humanClickLocator,
  humanDragLocatorHorizontal,
} from '../modules/human-engine/mouse.js';
import { randomBetween, sleep } from './utils.js';

const VISION_MODEL = 'claude-sonnet-4-6';
const MAX_ATTEMPTS = 3;

export type CaptchaVisionResult = 'disabled' | 'not_visible' | 'solved' | 'failed';
type CaptchaType = 'text' | 'grid' | 'slider';

export interface NaverCaptchaVisionContext {
  accountId?: string;
  humaJobId?: string;
  workspace?: string | null;
  jobType?: string;
  accountLabel?: string;
  resubmit?: () => Promise<void>;
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
  '#captcha .btn_confirm',
  '[class*="captcha"] [class*="confirm"]',
  '[class*="captcha"] button[type="submit"]',
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

async function captureCaptchaScreenshot(
  page: Page,
  type: CaptchaType,
): Promise<{ base64: string; mediaType: 'image/png' | 'image/jpeg' } | null> {
  if (type === 'text') {
    for (const sel of CAPTCHA_IMAGE_SELECTORS) {
      const img = page.locator(sel).first();
      if (await img.isVisible().catch(() => false)) {
        const buf = await img.screenshot({ type: 'png' }).catch(() => null);
        if (buf?.length) return { base64: buf.toString('base64'), mediaType: 'image/png' };
      }
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

async function safeHumanClick(page: Page, locator: Locator): Promise<void> {
  await locator.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
  const box = await locator.boundingBox().catch(() => null);
  if (box && box.width > 0 && box.height > 0) {
    await humanClickLocator(page, locator);
    return;
  }
  await locator.click({ force: true, timeout: 8000 });
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

function parseVisionSolveResult(raw: string | null, expectedType: CaptchaType): VisionSolveResult | null {
  if (!raw?.trim()) return null;
  const json = extractJsonObject(raw);
  if (json) {
    const type = (json.type as CaptchaType) ?? expectedType;
    const cells = Array.isArray(json.cells)
      ? json.cells.map((c) => Number(c)).filter((n) => Number.isFinite(n) && n >= 1)
      : undefined;
    const dragPx = json.dragPx != null ? Number(json.dragPx) : undefined;
    const dragPercent = json.dragPercent != null ? Number(json.dragPercent) : undefined;
    const answer =
      typeof json.answer === 'string'
        ? json.answer.trim()
        : typeof json.answer === 'number'
          ? String(json.answer)
          : undefined;
    if (type === 'grid' && cells?.length) return { type: 'grid', cells };
    if (type === 'slider' && (dragPx != null || dragPercent != null)) {
      return { type: 'slider', dragPx, dragPercent };
    }
    if (answer) return { type: 'text', answer };
  }

  if (expectedType === 'text') {
    const hangul = raw.match(/[가-힣]{2,}/)?.[0];
    if (hangul) return { type: 'text', answer: hangul };
    const hangulShort = raw.match(/[가-힣]/)?.[0];
    if (hangulShort && /한글|입력|이름|상품|메뉴|가게|품목/.test(raw)) {
      return { type: 'text', answer: hangulShort };
    }
    const alnum = raw.replace(/[^0-9a-zA-Z가-힣]/g, '');
    if (alnum.length) return { type: 'text', answer: alnum.slice(0, 32) };
    const digitMatch = raw.match(/\d+/);
    if (digitMatch) return { type: 'text', answer: digitMatch[0] };
  }
  return null;
}

async function solveCaptchaWithVision(
  imageBase64: string,
  mediaType: 'image/png' | 'image/jpeg',
  question: string,
  type: CaptchaType,
  meta: { cellCount?: number; trackWidthPx?: number },
): Promise<VisionSolveResult | null> {
  let system: string;
  let prompt: string;

  if (type === 'grid') {
    system = `You solve Naver image-grid CAPTCHA. Return ONLY JSON, no markdown.
Format: {"type":"grid","cells":[1,3,5]}
- cells: 1-based indices left-to-right, top-to-bottom (${meta.cellCount ?? '?'} cells total).
- Click ALL tiles matching the Korean instruction.`;
    prompt = `Question: ${question}\nGrid has ${meta.cellCount ?? 'unknown'} clickable tiles numbered 1..N row-major.`;
  } else if (type === 'slider') {
    system = `You solve Naver slide-puzzle CAPTCHA. Return ONLY JSON, no markdown.
Format: {"type":"slider","dragPx":127} OR {"type":"slider","dragPercent":0.62}
- dragPx: pixels to drag the slider handle RIGHT to align the puzzle piece.
- dragPercent: fraction of track width (0-1) if exact pixels unclear.
- Slider track width ≈ ${meta.trackWidthPx ?? 300}px.`;
    prompt = `Question: ${question}\nFind how far to drag the slider handle horizontally to complete the puzzle.`;
  } else {
    system = `You solve Naver Korean login CAPTCHA images. Return ONLY JSON: {"type":"text","answer":"..."}
Rules:
- Receipt "총 몇 개" / quantity questions: sum 개수 column only; ignore promo rows like "3+1". Answer: digits only.
- Receipt "한글로 입력" / store name / item name / menu name: copy exact Korean text (가-힣) from the receipt image.
- Multiple single-char boxes: answer is one string left-to-right (e.g. "사과" for 2 boxes, "007" for 3 digit boxes).
- Never return only a random number when the question asks for Korean text.`;
    prompt = `Question: ${question}`;
  }

  const raw = await askClaudeVision({
    model: VISION_MODEL,
    system,
    question: prompt,
    imageBase64,
    mediaType,
    max_tokens: type === 'grid' ? 192 : 128,
  });
  return parseVisionSolveResult(raw, type);
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
  await input.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
  const box = await input.boundingBox().catch(() => null);
  if (box && box.width > 0 && box.height > 0) {
    await humanClickLocator(page, input);
  } else {
    await input.focus().catch(() => {});
    await sleep(randomBetween(100, 300));
  }

  await input.fill('');
  const hasHangul = /[가-힣]/.test(text);
  if (hasHangul) {
    await page.keyboard.insertText(text);
    const val = await input.inputValue().catch(() => '');
    if (!val?.includes(text[0] ?? '')) {
      await input.fill(text);
    }
    return;
  }

  for (const ch of text) {
    await page.keyboard.type(ch, { delay: randomBetween(80, 160) });
  }
}

/** CAPTCHA 영역 내 보이는 입력칸만 (로그인 #id·#pw 제외). */
async function getVisibleCaptchaInputs(page: Page): Promise<Locator[]> {
  const root = await locateCaptchaRoot(page);
  const candidates = [
    root.locator(
      'input[type="text"], input[type="tel"], input[type="number"], input[maxlength], textarea',
    ),
    page.locator(CAPTCHA_ANSWER_INPUT_SELECTORS.join(', ')),
  ];

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

async function clickCaptchaConfirm(page: Page): Promise<void> {
  for (const sel of CONFIRM_SELECTORS) {
    const btn = page.locator(sel).first();
    if (await btn.isVisible().catch(() => false)) {
      const box = await btn.boundingBox().catch(() => null);
      if (box && box.width > 0 && box.height > 0) {
        await safeHumanClick(page, btn);
        await sleep(randomBetween(400, 900));
      }
      return;
    }
  }
}

async function submitCaptcha(page: Page, ctx: NaverCaptchaVisionContext): Promise<void> {
  if (ctx.accountId && page.url().includes('nidlogin')) {
    await ensureNaverLoginCredentialsForCaptcha(page, ctx.accountId);
    await humanSleep(500, 1200);
  }

  await clickCaptchaConfirm(page);

  if (ctx.resubmit) {
    await ctx.resubmit();
  } else if (page.url().includes('nidlogin')) {
    await clickNaverLoginButton(page);
  }
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
export async function tryAutoSolveNaverCaptcha(
  page: Page,
  ctx: NaverCaptchaVisionContext = {},
): Promise<CaptchaVisionResult> {
  if (!(await shouldAutoSolveCaptchaVision())) return 'disabled';
  if (!(await isNaverCaptchaVisible(page))) return 'not_visible';

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const captchaType = await detectCaptchaType(page);

      await logOperation({
        level: 'info',
        message: `[captcha-vision] ${captchaType} 자동 해결 시도 ${attempt}/${MAX_ATTEMPTS}`,
        job_id: ctx.humaJobId,
        account_id: ctx.accountId,
      });

      const shot = await captureCaptchaScreenshot(page, captchaType);
      if (!shot) break;

      const question = await readCaptchaQuestion(page);
      const root = await locateCaptchaRoot(page);
      const cells = captchaType === 'grid' ? await findGridCells(root) : [];
      const trackW = captchaType === 'slider' ? await getSliderTrackWidth(page, root) : undefined;

      const solved = await solveCaptchaWithVision(shot.base64, shot.mediaType, question, captchaType, {
        cellCount: cells.length || undefined,
        trackWidthPx: trackW,
      });
      if (!solved) {
        await humanSleep(3000, 7000);
        await refreshCaptchaImage(page);
        continue;
      }

      const applied = await applyVisionResult(page, captchaType, solved);
      if (!applied) break;

      await humanSleep(1500, 3500);
      await submitCaptcha(page, ctx);

      await sleep(randomBetween(2000, 4000));
      if (await captchaCleared(page)) {
        await logOperation({
          level: 'info',
          message: `[captcha-vision] ${captchaType} 자동 해결 성공 (시도 ${attempt})`,
          job_id: ctx.humaJobId,
          account_id: ctx.accountId,
        });
        return 'solved';
      }

      if (attempt < MAX_ATTEMPTS) {
        await humanSleep(3000, 7000);
        await refreshCaptchaImage(page);
      }
    } catch (err) {
      await logOperation({
        level: 'warn',
        message: `[captcha-vision] 시도 ${attempt} 오류: ${(err as Error).message}`,
        job_id: ctx.humaJobId,
        account_id: ctx.accountId,
      });
      if (attempt < MAX_ATTEMPTS) {
        await humanSleep(3000, 7000);
        await refreshCaptchaImage(page).catch(() => {});
      }
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
