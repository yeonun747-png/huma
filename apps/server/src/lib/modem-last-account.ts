import { redisConnection } from '../modules/queue/producer.js';
import { reconnectModemBySlot } from '../modules/modem/reconnect.js';
import { proxyPortToSlot } from './modem-ports.js';
import { sleep } from './utils.js';

const LAST_ACCOUNT_TTL_SEC = 86400;

function lastAccountKey(port: number): string {
  return `modem_last_account:${port}`;
}

export async function checkModemNeedsReconnect(port: number, accountId: string): Promise<boolean> {
  const last = await redisConnection.get(lastAccountKey(port));
  return last !== null && last !== accountId;
}

export async function recordLastAccountOnModem(port: number, accountId: string): Promise<void> {
  await redisConnection.set(lastAccountKey(port), accountId, 'EX', LAST_ACCOUNT_TTL_SEC);
}

/** v3.25 규칙 ⑥⑦ — 다른 계정이 쓰던 동글이면 IP 재발급 후 대기 */
export async function reconnectModemIfAccountSwitched(
  proxyPort: number,
  accountId: string,
): Promise<boolean> {
  const needs = await checkModemNeedsReconnect(proxyPort, accountId);
  if (!needs) return false;

  const slot = proxyPortToSlot(proxyPort);
  await reconnectModemBySlot(slot);

  const waitMs = Number(process.env.HUMA_CRANK_RECONNECT_WAIT_MS) || 10 * 60 * 1000;
  if (waitMs > 0) await sleep(waitMs);

  return true;
}
