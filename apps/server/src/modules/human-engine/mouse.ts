import type { Locator, Page } from 'playwright';
import { isNaverAuthChallengePage } from '../../lib/naver-auth-challenge.js';
import { randomBetween, sleep } from '../../lib/utils.js';
import { getSetting } from '../../lib/settings.js';
import { showVncAutomationPointer } from '../../lib/vnc-pointer.js';

function isNaverLoginOrChallengeUrl(url: string): boolean {
  const u = url.toLowerCase();
  if (!u.includes('naver.com')) return false;
  return (
    u.includes('nidlogin') ||
    u.includes('/login/ext/') ||
    u.includes('authkey') ||
    u.includes('otp') ||
    u.includes('device') ||
    u.includes('new_env') ||
    u.includes('2step') ||
    u.includes('certify') ||
    u.includes('loginpolicy')
  );
}

async function skipClickIfNaverAuthChallenge(page: Page): Promise<boolean> {
  if (!isNaverLoginOrChallengeUrl(page.url())) return false;
  return isNaverAuthChallengePage(page);
}

interface Point {
  x: number;
  y: number;
}

const mousePositions = new WeakMap<Page, Point>();

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}

function cubicBezier(t: number, p0: Point, p1: Point, p2: Point, p3: Point): Point {
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  };
}

function defaultMousePosition(page: Page): Point {
  const vp = page.viewportSize();
  if (vp) {
    return {
      x: Math.round(vp.width * (0.28 + Math.random() * 0.44)),
      y: Math.round(vp.height * (0.22 + Math.random() * 0.38)),
    };
  }
  return { x: 400, y: 300 };
}

export function getMousePosition(page: Page): Point {
  return mousePositions.get(page) ?? defaultMousePosition(page);
}

export function seedMousePosition(page: Page, pos?: Point): void {
  mousePositions.set(page, pos ?? defaultMousePosition(page));
}

export function setMousePosition(page: Page, pos: Point): void {
  mousePositions.set(page, pos);
}

export async function getClickJitterPx(): Promise<number> {
  const engine = await getSetting<{ fingerprint?: { click_jitter_px?: number } }>('human_engine', {});
  return engine.fingerprint?.click_jitter_px ?? 3;
}

/** 3차 베지어 — 이전 커서 위치에서 연속 이동 + 12% 확률 미세 overshoot */
export async function humanMouseMove(page: Page, x: number, y: number) {
  const start = getMousePosition(page);
  const end: Point = { x, y };
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const steps = randomBetween(18, 32);
  const cp1: Point = {
    x: start.x + dx * 0.25 + randomBetween(-80, 80),
    y: start.y + dy * 0.15 + randomBetween(-60, 60),
  };
  const cp2: Point = {
    x: start.x + dx * 0.75 + randomBetween(-80, 80),
    y: start.y + dy * 0.85 + randomBetween(-60, 60),
  };

  for (let i = 1; i <= steps; i++) {
    const t = easeInOut(i / steps);
    const p = cubicBezier(t, start, cp1, cp2, end);
    await page.mouse.move(p.x, p.y);
    await showVncAutomationPointer(page, p.x, p.y);
    await sleep(randomBetween(8, 22));
  }

  if (Math.random() < 0.12) {
    const ox = x + randomBetween(-10, 10);
    const oy = y + randomBetween(-8, 8);
    await page.mouse.move(ox, oy);
    await showVncAutomationPointer(page, ox, oy);
    await sleep(randomBetween(18, 48));
    await page.mouse.move(x, y);
    await showVncAutomationPointer(page, x, y);
    await sleep(randomBetween(10, 24));
  }

  setMousePosition(page, { x, y });
}

export async function humanClickLocator(
  page: Page,
  locator: Locator,
  jitterPx?: number,
  preClickDelayMs: [number, number] = [100, 400],
) {
  if (await skipClickIfNaverAuthChallenge(page)) return;

  let lastBox: Awaited<ReturnType<Locator['boundingBox']>> = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await locator.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
    await locator.waitFor({ state: 'visible', timeout: attempt === 0 ? 5000 : 1500 }).catch(() => {});
    lastBox = await locator.boundingBox();
    if (lastBox) break;
    await sleep(randomBetween(200, 450));
  }
  if (!lastBox) {
    throw new Error('HUMAN_CLICK_NO_BBOX');
  }
  const box = lastBox;
  const jitter = jitterPx ?? (await getClickJitterPx());
  const cx = box.x + box.width / 2 + randomBetween(-jitter, jitter);
  const cy = box.y + box.height / 2 + randomBetween(-jitter, jitter);
  await humanMouseMove(page, cx, cy);
  await sleep(randomBetween(preClickDelayMs[0], preClickDelayMs[1]));
  await page.mouse.click(cx, cy);
  await showVncAutomationPointer(page, cx, cy, { click: true });
  setMousePosition(page, { x: cx, y: cy });
}

/** viewport 좌표 — 베지어 이동·jitter·클릭 전 딜레이 */
export async function humanClickAtPoint(
  page: Page,
  x: number,
  y: number,
  jitterPx?: number,
  preClickDelayMs: [number, number] = [80, 220],
): Promise<void> {
  if (await skipClickIfNaverAuthChallenge(page)) return;

  const jitter = jitterPx ?? (await getClickJitterPx());
  const cx = x + randomBetween(-jitter, jitter);
  const cy = y + randomBetween(-jitter, jitter);
  await humanMouseMove(page, cx, cy);
  await sleep(randomBetween(preClickDelayMs[0], preClickDelayMs[1]));
  await page.mouse.click(cx, cy);
  await showVncAutomationPointer(page, cx, cy, { click: true });
  setMousePosition(page, { x: cx, y: cy });
}

/** humanClickLocator 실패 시 bbox 중심 humanClickAtPoint — Playwright .click() 금지 */
export async function humanClickLocatorFallback(
  page: Page,
  locator: Locator,
  preClickDelayMs: [number, number] = [80, 260],
): Promise<boolean> {
  try {
    await humanClickLocator(page, locator, undefined, preClickDelayMs);
    return true;
  } catch {
    await locator.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
    const box = await locator.boundingBox().catch(() => null);
    if (!box || box.width <= 0 || box.height <= 0) return false;
    await humanClickAtPoint(
      page,
      box.x + box.width / 2,
      box.y + box.height / 2,
      undefined,
      preClickDelayMs,
    );
    return true;
  }
}

export async function humanClick(page: Page, selector: string, jitterPx?: number) {
  await humanClickLocator(page, page.locator(selector).first(), jitterPx);
}

/** 베지어 드래그 — 슬라이드 퍼즐·캡차 슬라이더 (Y축 미세 흔들림) */
export async function humanDrag(
  page: Page,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
): Promise<void> {
  if (await skipClickIfNaverAuthChallenge(page)) return;

  const endY = toY + randomBetween(-4, 4);
  await humanMouseMove(page, fromX, fromY);
  await sleep(randomBetween(100, 280));
  await page.mouse.down();
  await sleep(randomBetween(40, 120));

  const start: Point = { x: fromX, y: fromY };
  const end: Point = { x: toX, y: endY };
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const steps = randomBetween(22, 38);
  const cp1: Point = {
    x: start.x + dx * 0.2 + randomBetween(-12, 12),
    y: start.y + dy * 0.1 + randomBetween(-8, 8),
  };
  const cp2: Point = {
    x: start.x + dx * 0.8 + randomBetween(-12, 12),
    y: start.y + dy * 0.9 + randomBetween(-8, 8),
  };

  for (let i = 1; i <= steps; i++) {
    const t = easeInOut(i / steps);
    const p = cubicBezier(t, start, cp1, cp2, end);
    const wobble = Math.sin(t * Math.PI) * randomBetween(-2, 2);
    await page.mouse.move(p.x, p.y + wobble);
    await showVncAutomationPointer(page, p.x, p.y + wobble);
    await sleep(randomBetween(10, 24));
  }

  await sleep(randomBetween(80, 200));
  await page.mouse.up();
  setMousePosition(page, { x: toX, y: endY });
}

/** 핸들 요소 중심에서 수평 드래그 */
export async function humanDragLocatorHorizontal(
  page: Page,
  locator: Locator,
  offsetX: number,
): Promise<void> {
  await locator.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
  const box = await locator.boundingBox();
  if (!box) throw new Error('HUMAN_DRAG_NO_BBOX');
  const jitter = await getClickJitterPx();
  const fromX = box.x + box.width / 2 + randomBetween(-jitter, jitter);
  const fromY = box.y + box.height / 2 + randomBetween(-jitter, jitter);
  await humanDrag(page, fromX, fromY, fromX + offsetX, fromY);
}

export async function humanNavigateViaLink(page: Page, locator: Locator): Promise<void> {
  const popupPromise = page.context().waitForEvent('page', { timeout: 5000 }).catch(() => null);
  await humanClickLocator(page, locator);
  const popup = await popupPromise;
  if (popup) {
    await popup.waitForLoadState('domcontentloaded').catch(() => {});
    const url = popup.url();
    await popup.close();
    if (url && !url.startsWith('about:')) {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });
    }
    return;
  }
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
}

