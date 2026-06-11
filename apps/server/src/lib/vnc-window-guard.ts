import type { BrowserContext, Page } from 'playwright';

import {
  isVncTilingEnabled,
  resolveVncChromeForProxyPort,
} from './vnc-window-layout.js';

const GUARD_INTERVAL_MS = 2000;

async function windowIdForPage(page: Page): Promise<number | null> {
  const cdp = await page.context().newCDPSession(page);
  try {
    const { targetInfo } = await cdp.send('Target.getTargetInfo');
    const { windowId } = await cdp.send('Browser.getWindowForTarget', {
      targetId: targetInfo.targetId,
    });
    return windowId;
  } catch {
    return null;
  }
}

/** 클릭·최대화 후에도 VNC 3열 슬롯 크기·위치 유지 */
export async function enforceVncWindowBounds(
  context: BrowserContext,
  proxyPort: number,
  headless = false,
): Promise<void> {
  if (!isVncTilingEnabled(headless)) return;

  const chrome = await resolveVncChromeForProxyPort(proxyPort);
  if (!chrome) return;

  const page = context.pages()[0];
  if (!page) return;

  const windowId = await windowIdForPage(page);
  if (windowId == null) return;

  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send('Browser.setWindowBounds', {
      windowId,
      bounds: {
        left: chrome.x,
        top: chrome.y,
        width: chrome.width,
        height: chrome.height,
        windowState: 'normal',
      },
    });
  } catch {
    /* headless·구형 Chromium */
  }
}

/** 세션 동안 주기적으로 창 geometry 복원 (최대화·드래그 확대 방지) */
export function startVncWindowGuard(
  context: BrowserContext,
  proxyPort: number | undefined,
  headless: boolean,
): void {
  if (!proxyPort || !isVncTilingEnabled(headless)) return;

  let stopped = false;
  const tick = () => {
    if (stopped) return;
    void enforceVncWindowBounds(context, proxyPort, headless);
  };

  void tick();
  const timer = setInterval(tick, GUARD_INTERVAL_MS);

  context.on('page', tick);
  context.on('close', () => {
    stopped = true;
    clearInterval(timer);
  });
}
