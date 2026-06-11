import { redisConnection } from '../modules/queue/producer.js';
import {
  CRANK_PROXY_PORTS,
  POSTING_PROXY_PORTS,
  isCrankProxyPort,
  isPostingProxyPort,
} from './modem-ports.js';

const VNC_COLS = 3;

function crankLockKey(port: number) {
  return `modem_lock:${port}`;
}

function postingLockKey(port: number) {
  return `modem_lock:posting:${port}`;
}

export function resolveVncCanvas(): { w: number; h: number } {
  return {
    w: Number(process.env.HUMA_VNC_WIDTH) || 2560,
    h: Number(process.env.HUMA_VNC_HEIGHT) || 1080,
  };
}

export function isVncTilingEnabled(headless: boolean): boolean {
  if (headless || process.platform !== 'linux') return false;
  if (process.env.HUMA_VNC_LAYOUT === 'off') return false;
  return true;
}

/** Redis 기준 headful VNC에 올라온 세션 수 (동글 락) */
export async function countActiveVncModemSessions(): Promise<{ crank: number; posting: number }> {
  let crank = 0;
  for (const port of CRANK_PROXY_PORTS) {
    if (await redisConnection.get(crankLockKey(port))) crank++;
  }
  let posting = 0;
  for (const port of POSTING_PROXY_PORTS) {
    if (await redisConnection.get(postingLockKey(port))) posting++;
  }
  return { crank, posting };
}

export interface VncWindowChrome {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Xvfb(:99) 2560×1080 고정 3열 — 최대 C-Rank 2 + 발행 1 동시 headful 겹침 방지
 * · 10006 왼쪽 · 10007 가운데 · 10001~10005 오른쪽(또는 C-Rank 없을 때 발행 단독 전체 화면)
 */
export function vncWindowChromeForProxyPort(
  proxyPort: number,
  sessions: { crank: number; posting: number },
): VncWindowChrome | null {
  const { w, h } = resolveVncCanvas();
  const tileW = Math.floor(w / VNC_COLS);

  if (isCrankProxyPort(proxyPort)) {
    const idx = CRANK_PROXY_PORTS.indexOf(proxyPort as (typeof CRANK_PROXY_PORTS)[number]);
    if (idx < 0) return null;
    return { x: idx * tileW, y: 0, width: tileW, height: h };
  }

  if (isPostingProxyPort(proxyPort)) {
    if (sessions.crank === 0) {
      return { x: 0, y: 0, width: w, height: h };
    }
    return { x: 2 * tileW, y: 0, width: w - 2 * tileW, height: h };
  }

  return null;
}

export function vncSlotLabelKo(
  proxyPort: number,
  sessions?: { crank: number; posting: number },
): string {
  if (isCrankProxyPort(proxyPort)) {
    const idx = CRANK_PROXY_PORTS.indexOf(proxyPort as (typeof CRANK_PROXY_PORTS)[number]);
    if (idx === 0) return 'VNC 왼쪽 열 (실폰 6)';
    if (idx === 1) return 'VNC 가운데 열 (실폰 7)';
  }
  if (isPostingProxyPort(proxyPort)) {
    if (sessions && sessions.crank === 0) return 'VNC 전체 화면';
    return 'VNC 오른쪽 열 (발행)';
  }
  return 'VNC';
}

export async function vncWindowLaunchArgs(
  proxyPort: number | undefined,
  headless: boolean,
): Promise<string[]> {
  if (!isVncTilingEnabled(headless) || !proxyPort) return [];

  const sessions = await countActiveVncModemSessions();
  const chrome = vncWindowChromeForProxyPort(proxyPort, sessions);
  if (!chrome) return [];

  return [
    `--window-position=${chrome.x},${chrome.y}`,
    `--window-size=${chrome.width},${chrome.height}`,
  ];
}
