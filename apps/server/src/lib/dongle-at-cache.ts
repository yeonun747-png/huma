import { redisConnection } from '../modules/queue/producer.js';

const AT_PORT_TTL_SEC = 30 * 86400;

function atPortKey(slot: number): string {
  return `dongle_at_port:slot${slot}`;
}

/** i7에서 한 번 성공한 ttyUSB — 다음 IP 교체 1회 성공률 향상 */
export async function getCachedAtPort(slot: number): Promise<string | undefined> {
  const raw = await redisConnection.get(atPortKey(slot));
  return raw?.trim() || undefined;
}

export async function setCachedAtPort(slot: number, port: string): Promise<void> {
  const p = port.trim();
  if (!p.startsWith('/dev/')) return;
  await redisConnection.set(atPortKey(slot), p, 'EX', AT_PORT_TTL_SEC);
}

/** `[lte-reset] ✓ eth5 AT+CFUN airplane (/dev/ttyUSB17)` */
export function parseAtPortFromLteResetLog(line: string): string | undefined {
  const m = line.match(/AT\+CFUN airplane \((\/dev\/tty[^)]+)\)/i);
  return m?.[1];
}
