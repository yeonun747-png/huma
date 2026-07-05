import type { Locator, Page } from 'playwright';
import { isNaverAuthChallengePage } from '../../lib/naver-auth-challenge.js';
import { randomBetween, sleep } from '../../lib/utils.js';
import { getSetting } from '../../lib/settings.js';
import { showVncAutomationPointer } from '../../lib/vnc-pointer.js';

function isNaverLoginOrChallengeUrl(url: string): boolean {
  const u = url.toLowerCase();
  if (u.includes('captcha.naver.com') || u.includes('/captcha')) return true;
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

/** nidlogin·캡cha — 베지어를 느리게( lite 금지 ). 호출부에서 login 미지정 시 URL로 자동 판별 */
function resolveMousePace(
  page: Page,
  opts?: { lite?: boolean; login?: boolean },
): { lite: boolean; login: boolean } {
  if (opts?.lite) return { lite: true, login: false };
  if (opts?.login) return { lite: false, login: true };
  if (isNaverLoginOrChallengeUrl(page.url())) return { lite: false, login: true };
  return { lite: false, login: false };
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
export async function humanMouseMove(
  page: Page,
  x: number,
  y: number,
  opts?: { lite?: boolean; login?: boolean },
) {
  const pace = resolveMousePace(page, opts);
  const start = getMousePosition(page);
  const end: Point = { x, y };
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const dist = Math.hypot(dx, dy);
  const steps = pace.lite
    ? randomBetween(5, 9)
    : pace.login
      ? randomBetween(16, Math.min(28, 12 + Math.floor(dist / 45)))
      : randomBetween(18, 32);
  const skipX11 = pace.lite || pace.login;
  const cpSpread = pace.login ? 48 : 80;
  const cp1: Point = {
    x: start.x + dx * 0.25 + randomBetween(-cpSpread, cpSpread),
    y: start.y + dy * 0.15 + randomBetween(-cpSpread * 0.75, cpSpread * 0.75),
  };
  const cp2: Point = {
    x: start.x + dx * 0.75 + randomBetween(-cpSpread, cpSpread),
    y: start.y + dy * 0.85 + randomBetween(-cpSpread * 0.75, cpSpread * 0.75),
  };

  for (let i = 1; i <= steps; i++) {
    const t = easeInOut(i / steps);
    const p = cubicBezier(t, start, cp1, cp2, end);
    await page.mouse.move(p.x, p.y);
    await showVncAutomationPointer(page, p.x, p.y, {
      skipX11Sync: skipX11 && i < steps,
    });
    await sleep(
      randomBetween(
        pace.lite ? 4 : pace.login ? 16 : 8,
        pace.lite ? 12 : pace.login ? 38 : 22,
      ),
    );
  }

  if (Math.random() < (pace.lite ? 0.04 : pace.login ? 0.08 : 0.12)) {
    const ox = x + randomBetween(-10, 10);
    const oy = y + randomBetween(-8, 8);
    await page.mouse.move(ox, oy);
    await showVncAutomationPointer(page, ox, oy, { skipX11Sync: skipX11 });
    await sleep(randomBetween(pace.lite ? 8 : pace.login ? 18 : 18, pace.lite ? 20 : pace.login ? 40 : 48));
    await page.mouse.move(x, y);
    await showVncAutomationPointer(page, x, y, { skipX11Sync: skipX11 });
    await sleep(randomBetween(pace.lite ? 6 : pace.login ? 14 : 10, pace.lite ? 14 : pace.login ? 28 : 24));
  }

  setMousePosition(page, { x, y });
  if (skipX11) {
    await showVncAutomationPointer(page, x, y, { skipX11Sync: true });
  }
}

export async function humanClickLocator(
  page: Page,
  locator: Locator,
  jitterPx?: number,
  preClickDelayMs: [number, number] = [100, 400],
  opts?: { lite?: boolean; login?: boolean },
) {
  if (await skipClickIfNaverAuthChallenge(page)) return;

  const pace = resolveMousePace(page, opts);
  const scrollTimeout = pace.lite || pace.login ? 2500 : 5000;
  const visibleTimeout = pace.lite ? 2000 : pace.login ? 2500 : 5000;
  let lastBox: Awaited<ReturnType<Locator['boundingBox']>> = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await locator.scrollIntoViewIfNeeded({ timeout: scrollTimeout }).catch(() => {});
    await locator
      .waitFor({ state: 'visible', timeout: attempt === 0 ? visibleTimeout : pace.lite ? 800 : 1500 })
      .catch(() => {});
    lastBox = await locator.boundingBox();
    if (lastBox) break;
    await sleep(randomBetween(pace.lite ? 80 : 200, pace.lite ? 180 : 450));
  }
  if (!lastBox) {
    throw new Error('HUMAN_CLICK_NO_BBOX');
  }
  const box = lastBox;
  const jitter = jitterPx ?? (await getClickJitterPx());
  const cx = box.x + box.width / 2 + randomBetween(-jitter, jitter);
  const cy = box.y + box.height / 2 + randomBetween(-jitter, jitter);
  await humanMouseMove(page, cx, cy, { lite: pace.lite, login: pace.login });
  const delay = pace.lite
    ? ([40, 120] as [number, number])
    : pace.login
      ? ([140, 320] as [number, number])
      : preClickDelayMs;
  await sleep(randomBetween(delay[0], delay[1]));
  await page.mouse.click(cx, cy);
  await showVncAutomationPointer(page, cx, cy, { click: true, skipX11Sync: pace.lite || pace.login });
  setMousePosition(page, { x: cx, y: cy });
}

/** viewport 좌표 — 베지어 이동·jitter·클릭 전 딜레이 */
export async function humanClickAtPoint(
  page: Page,
  x: number,
  y: number,
  jitterPx?: number,
  preClickDelayMs: [number, number] = [80, 220],
  opts?: { lite?: boolean; login?: boolean },
): Promise<void> {
  if (await skipClickIfNaverAuthChallenge(page)) return;

  const pace = resolveMousePace(page, opts);
  const jitter = jitterPx ?? (await getClickJitterPx());
  const cx = x + randomBetween(-jitter, jitter);
  const cy = y + randomBetween(-jitter, jitter);
  await humanMouseMove(page, cx, cy, { lite: pace.lite, login: pace.login });
  const delay = pace.lite
    ? ([35, 100] as [number, number])
    : pace.login
      ? ([130, 300] as [number, number])
      : preClickDelayMs;
  await sleep(randomBetween(delay[0], delay[1]));
  await page.mouse.click(cx, cy);
  await showVncAutomationPointer(page, cx, cy, {
    click: true,
    skipX11Sync: pace.lite || pace.login,
  });
  setMousePosition(page, { x: cx, y: cy });
}

/** humanClickLocator 실패 시 bbox 중심 humanClickAtPoint — Playwright .click() 금지 */
export async function humanClickLocatorFallback(
  page: Page,
  locator: Locator,
  preClickDelayMs: [number, number] = [80, 260],
  opts?: { lite?: boolean; login?: boolean },
): Promise<boolean> {
  try {
    await humanClickLocator(page, locator, undefined, preClickDelayMs, opts);
    return true;
  } catch {
    await locator.scrollIntoViewIfNeeded({ timeout: opts?.lite ? 2500 : 5000 }).catch(() => {});
    const box = await locator.boundingBox().catch(() => null);
    if (!box || box.width <= 0 || box.height <= 0) return false;
    await humanClickAtPoint(
      page,
      box.x + box.width / 2,
      box.y + box.height / 2,
      undefined,
      preClickDelayMs,
      opts,
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

  const authPace = isNaverLoginOrChallengeUrl(page.url());
  const endY = toY + randomBetween(-4, 4);
  await humanMouseMove(page, fromX, fromY, authPace ? { login: true } : undefined);
  await sleep(randomBetween(authPace ? 140 : 100, authPace ? 320 : 280));
  await page.mouse.down();
  await sleep(randomBetween(authPace ? 60 : 40, authPace ? 160 : 120));

  const start: Point = { x: fromX, y: fromY };
  const end: Point = { x: toX, y: endY };
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const steps = authPace ? randomBetween(26, 42) : randomBetween(22, 38);
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
    await showVncAutomationPointer(page, p.x, p.y + wobble, { skipX11Sync: authPace });
    await sleep(randomBetween(authPace ? 14 : 10, authPace ? 32 : 24));
  }

  await sleep(randomBetween(authPace ? 100 : 80, authPace ? 240 : 200));
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

