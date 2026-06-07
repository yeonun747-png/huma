import type { Locator, Page } from 'playwright';
import { randomBetween, sleep } from '../../lib/utils.js';
import { getSetting } from '../../lib/settings.js';

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
    await sleep(randomBetween(8, 22));
  }

  if (Math.random() < 0.12) {
    const ox = x + randomBetween(-10, 10);
    const oy = y + randomBetween(-8, 8);
    await page.mouse.move(ox, oy);
    await sleep(randomBetween(18, 48));
    await page.mouse.move(x, y);
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
  await locator.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
  const box = await locator.boundingBox();
  if (!box) {
    throw new Error('HUMAN_CLICK_NO_BBOX');
  }
  const jitter = jitterPx ?? (await getClickJitterPx());
  const cx = box.x + box.width / 2 + randomBetween(-jitter, jitter);
  const cy = box.y + box.height / 2 + randomBetween(-jitter, jitter);
  await humanMouseMove(page, cx, cy);
  await sleep(randomBetween(preClickDelayMs[0], preClickDelayMs[1]));
  await page.mouse.click(cx, cy);
  setMousePosition(page, { x: cx, y: cy });
}

export async function humanClick(page: Page, selector: string, jitterPx?: number) {
  await humanClickLocator(page, page.locator(selector).first(), jitterPx);
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
