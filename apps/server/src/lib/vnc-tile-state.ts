import { redisConnection } from '../modules/queue/producer.js';
import {
  CRANK_PROXY_PORTS,
  POSTING_PROXY_PORTS,
  isCrankProxyPort,
  isPostingProxyPort,
} from './modem-ports.js';

/** 타일 순서: Crank1 · Crank2 · 연운1 · 연운2 · 연운3 */
export const VNC_TILE_SLOT_ORDER = [10006, 10007, 10001, 10002, 10003] as const;

const FOCUS_REDIS_KEY = 'vnc:focus_proxy_port';

function crankLockKey(port: number) {
  return `modem_lock:${port}`;
}

function postingLockKey(port: number) {
  return `modem_lock:posting:${port}`;
}

export async function getVncFocusPort(): Promise<number | null> {
  const raw = await redisConnection.get(FOCUS_REDIS_KEY);
  if (!raw) return null;
  const port = Number(raw);
  return Number.isFinite(port) ? port : null;
}

export async function setVncFocusPort(proxyPort: number | null): Promise<void> {
  if (proxyPort == null) {
    await redisConnection.del(FOCUS_REDIS_KEY);
    return;
  }
  await redisConnection.set(FOCUS_REDIS_KEY, String(proxyPort), 'EX', 86_400);
}

async function isProxyPortSessionActive(proxyPort: number): Promise<boolean> {
  if (isCrankProxyPort(proxyPort)) {
    return Boolean(await redisConnection.get(crankLockKey(proxyPort)));
  }
  if (isPostingProxyPort(proxyPort)) {
    return Boolean(await redisConnection.get(postingLockKey(proxyPort)));
  }
  return false;
}

export async function listActiveVncTilePorts(): Promise<number[]> {
  const active: number[] = [];
  for (const port of VNC_TILE_SLOT_ORDER) {
    if (await isProxyPortSessionActive(port)) active.push(port);
  }
  return active;
}

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

export function isVncManagedProxyPort(proxyPort: number): boolean {
  return (VNC_TILE_SLOT_ORDER as readonly number[]).includes(proxyPort);
}
