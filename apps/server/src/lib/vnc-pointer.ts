import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { Page } from 'playwright';

import { isVncHeadfulSession } from './vnc-session.js';

const execFileAsync = promisify(execFile);

type ScreenOffset = { left: number; top: number; chromeH: number; at: number };

const screenOffsetByPage = new WeakMap<Page, ScreenOffset>();
let xdotoolAvailable: boolean | null = null;

export function isVncPointerOverlayEnabled(): boolean {
  if (!isVncHeadfulSession()) return false;
  return process.env.HUMA_VNC_SHOW_POINTER !== 'false';
}

export function isVncX11CursorSyncEnabled(): boolean {
  if (!isVncPointerOverlayEnabled()) return false;
  return process.env.HUMA_VNC_X11_CURSOR !== 'false';
}

/** 모든 페이지 — VNC에서 자동화 클릭·이동 위치 표시 */
export const VNC_POINTER_INIT_SCRIPT = `(() => {
  if (window.__humaVncPointer) return;
  const mk = () => {
    const el = document.createElement('div');
    el.id = '__huma_vnc_pointer';
    el.setAttribute('aria-hidden', 'true');
    el.style.cssText =
      'position:fixed;z-index:2147483647;width:16px;height:16px;margin:-8px 0 0 -8px;' +
      'border:2px solid #111;border-radius:50%;background:#fff;' +
      'box-shadow:0 0 0 1px #fff,0 2px 8px rgba(0,0,0,.35);pointer-events:none;' +
      'transition:left 35ms linear,top 35ms linear;visibility:hidden;';
    (document.documentElement || document.body).appendChild(el);
    return el;
  };
  const el = mk();
  const clickRipple = () => {
    el.style.transform = 'scale(1.35)';
    el.style.borderColor = '#e03e3e';
    setTimeout(() => {
      el.style.transform = '';
      el.style.borderColor = '#111';
    }, 180);
  };
  window.__humaVncPointer = {
    show(x, y) {
      el.style.left = Math.round(x) + 'px';
      el.style.top = Math.round(y) + 'px';
      el.style.visibility = 'visible';
    },
    hide() {
      el.style.visibility = 'hidden';
    },
    click() {
      clickRipple();
    },
  };
})();`;

export async function injectVncPointerOverlay(page: Page): Promise<void> {
  if (!isVncPointerOverlayEnabled()) return;
  await page.addInitScript(VNC_POINTER_INIT_SCRIPT).catch(() => {});
  await page
    .evaluate((script) => {
      const w = window as Window & {
        __humaVncPointer?: { show: (x: number, y: number) => void; hide: () => void; click: () => void };
      };
      if (!w.__humaVncPointer) {
        const fn = new Function(script) as () => void;
        fn();
      }
    }, VNC_POINTER_INIT_SCRIPT)
    .catch(() => {});
}

async function resolveScreenOffset(page: Page): Promise<ScreenOffset | null> {
  const cached = screenOffsetByPage.get(page);
  if (cached && Date.now() - cached.at < 2500) return cached;

  try {
    const cdp = await page.context().newCDPSession(page);
    const { targetInfo } = await cdp.send('Target.getTargetInfo');
    const { windowId } = await cdp.send('Browser.getWindowForTarget', {
      targetId: targetInfo.targetId,
    });
    const { bounds } = await cdp.send('Browser.getWindowBounds', { windowId });
    const chromeH = await page
      .evaluate(() => Math.max(0, window.outerHeight - window.innerHeight))
      .catch(() => 88);

    const offset: ScreenOffset = {
      left: bounds.left ?? 0,
      top: bounds.top ?? 0,
      chromeH,
      at: Date.now(),
    };
    screenOffsetByPage.set(page, offset);
    return offset;
  } catch {
    return null;
  }
}

async function syncX11Cursor(page: Page, viewportX: number, viewportY: number): Promise<void> {
  if (!isVncX11CursorSyncEnabled()) return;

  if (xdotoolAvailable === false) return;
  if (xdotoolAvailable === null) {
    try {
      await execFileAsync('which', ['xdotool'], { timeout: 1500 });
      xdotoolAvailable = true;
    } catch {
      xdotoolAvailable = false;
      return;
    }
  }

  const offset = await resolveScreenOffset(page);
  if (!offset) return;

  const screenX = Math.round(offset.left + viewportX);
  const screenY = Math.round(offset.top + offset.chromeH + viewportY);
  const display = process.env.DISPLAY ?? ':99';

  await execFileAsync('xdotool', ['mousemove', '--sync', String(screenX), String(screenY)], {
    env: { ...process.env, DISPLAY: display },
    timeout: 2000,
  }).catch(() => {});
}

/** VNC — 페이지 오버레이 + (가능 시) X11 커서 동기화 */
export async function showVncAutomationPointer(
  page: Page,
  x: number,
  y: number,
  options?: { click?: boolean },
): Promise<void> {
  if (!isVncPointerOverlayEnabled()) return;

  await page
    .evaluate(
      ({ px, py, click, script }) => {
        const w = window as Window & {
          __humaVncPointer?: { show: (x: number, y: number) => void; click: () => void };
        };
        if (!w.__humaVncPointer) {
          const fn = new Function(script) as () => void;
          fn();
        }
        w.__humaVncPointer?.show(px, py);
        if (click) w.__humaVncPointer?.click();
      },
      { px: x, py: y, click: options?.click === true, script: VNC_POINTER_INIT_SCRIPT },
    )
    .catch(() => {});

  await syncX11Cursor(page, x, y);
}

export function invalidateVncScreenOffset(page: Page): void {
  screenOffsetByPage.delete(page);
}
