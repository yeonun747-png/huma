import { getVncFocusPort } from './vnc-tile-state.js';
import {
  isVncManagedProxyPort,
  listActiveVncTilePorts,
  countActiveVncModemSessions,
} from './vnc-tile-state.js';
import { vncLabelForProxyPort } from './vnc-focus.js';

export { countActiveVncModemSessions, listActiveVncTilePorts, isVncManagedProxyPort };
export { VNC_TILE_SLOT_ORDER } from './vnc-tile-state.js';

export function resolveVncCanvas(): { w: number; h: number } {
  return {
    w: Number(process.env.HUMA_VNC_WIDTH) || 2560,
    h: Number(process.env.HUMA_VNC_HEIGHT) || 1080,
  };
}

/** VNC 워크플로우 Chromium 상단 여백 */
export function resolveVncLayoutTopY(): number {
  const explicit = Number(process.env.HUMA_VNC_LAYOUT_TOP_Y);
  if (Number.isFinite(explicit) && explicit >= 0) return Math.round(explicit);
  return 0;
}

export function isVncTilingEnabled(headless: boolean): boolean {
  if (headless || process.platform !== 'linux') return false;
  if (process.env.HUMA_VNC_LAYOUT === 'off') return false;
  return true;
}

export interface VncWindowChrome {
  x: number;
  y: number;
  width: number;
  height: number;
  windowState?: 'normal' | 'minimized' | 'maximized' | 'fullscreen';
}

function tiledChrome(
  proxyPort: number,
  activePorts: number[],
  w: number,
  h: number,
  top: number,
): VncWindowChrome | null {
  const idx = activePorts.indexOf(proxyPort);
  if (idx < 0) return null;

  const workH = Math.max(h - top, 200);
  const n = activePorts.length;
  if (n === 1) {
    return { x: 0, y: top, width: w, height: workH, windowState: 'normal' };
  }

  const tileW = Math.floor(w / n);
  const x = idx * tileW;
  const width = idx === n - 1 ? w - x : tileW;
  return { x, y: top, width, height: workH, windowState: 'normal' };
}

export async function resolveVncChromeForProxyPort(
  proxyPort: number,
): Promise<VncWindowChrome | null> {
  if (!isVncManagedProxyPort(proxyPort)) return null;

  const { w, h } = resolveVncCanvas();
  const top = resolveVncLayoutTopY();
  const workH = Math.max(h - top, 200);
  const focusPort = await getVncFocusPort();

  if (focusPort !== null) {
    if (proxyPort === focusPort) {
      return { x: 0, y: top, width: w, height: workH, windowState: 'normal' };
    }
    return { x: 0, y: 0, width: 320, height: 240, windowState: 'minimized' };
  }

  const activePorts = await listActiveVncTilePorts();
  const tiled = tiledChrome(proxyPort, activePorts, w, h, top);
  if (tiled) return tiled;

  return { x: 0, y: top, width: w, height: workH, windowState: 'normal' };
}

export function vncSlotLabelKo(proxyPort: number): string {
  const label = vncLabelForProxyPort(proxyPort);
  if (label) return `VNC ${label}`;
  return 'VNC';
}

export async function vncWindowLaunchArgs(
  proxyPort: number | undefined,
  headless: boolean,
): Promise<string[]> {
  if (!isVncTilingEnabled(headless) || !proxyPort) return [];

  const chrome = await resolveVncChromeForProxyPort(proxyPort);
  if (!chrome) return [];

  return [
    `--window-position=${chrome.x},${chrome.y}`,
    `--window-size=${chrome.width},${chrome.height}`,
  ];
}
