import { supabase } from '../middleware/auth.js';
import { redisConnection } from '../modules/queue/producer.js';
import { reconnectModemBySlot } from '../modules/modem/reconnect.js';
import { proxyPortToSlot } from './modem-ports.js';
import { logOperation } from './log-emitter.js';
import { sleep } from './utils.js';

const LAST_ACCOUNT_TTL_SEC = 86400;
const RECONNECT_ATTEMPTS = 2;

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

function assertModemSessionReady(status: string | null | undefined, slot: number): void {
  if (status === 'error' || status === 'offline') {
    throw new Error(`MODEM_UNHEALTHY:slot${slot}:${status ?? 'unknown'}`);
  }
}

/**
 * v3.33 C-Rank — 다른 계정이 쓰던 동글이면 비행기모드 1회 시도.
 * IP 교체 실패·동일 IP 재할당·error 동글이면 세션 중단 (구 IP로 다른 계정 로그인 방지).
 */
export async function reconnectModemIfAccountSwitched(
  proxyPort: number,
  accountId: string,
): Promise<boolean> {
  const lastAccountId = await redisConnection.get(lastAccountKey(proxyPort));
  const needs = lastAccountId !== null && lastAccountId !== accountId;

  const slot = proxyPortToSlot(proxyPort);
  const [{ data: modem }, { data: account }] = await Promise.all([
    supabase.from('huma_modems').select('id, current_ip, status').eq('slot_number', slot).single(),
    supabase.from('huma_accounts').select('name, crank_workspace').eq('id', accountId).single(),
  ]);

  assertModemSessionReady(modem?.status, slot);

  const logBase = {
    workspace: (account?.crank_workspace as string | undefined) ?? 'yeonun',
    platform: 'naver_crank',
    account_id: accountId,
    modem_id: modem?.id,
    metadata: { source: 'crank_session' },
  };

  if (!needs) {
    const ipNote = modem?.current_ip ?? '?';
    const message =
      lastAccountId === null
        ? `C-Rank 세션 시작 — :${proxyPort} IP ${ipNote} (동글 첫 계정)`
        : `C-Rank 세션 시작 — 동일 계정·IP 유지 (${ipNote})`;
    await logOperation({ level: 'info', message, ...logBase });
    return false;
  }

  const oldIp = modem?.current_ip ?? null;
  let newIp: string | undefined;
  let lastErr: Error | undefined;

  for (let attempt = 1; attempt <= RECONNECT_ATTEMPTS; attempt++) {
    try {
      newIp = await reconnectModemBySlot(slot);
      break;
    } catch (err) {
      lastErr = err as Error;
      if (attempt < RECONNECT_ATTEMPTS) {
        await sleep(5000);
      }
    }
  }

  if (!newIp) {
    await logOperation({
      level: 'ERROR',
      message: `C-Rank 계정 전환 — IP 교체 실패(${RECONNECT_ATTEMPTS}회), 세션 중단: ${lastErr?.message ?? 'unknown'}`,
      ...logBase,
    });
    throw new Error(`MODEM_IP_ROTATE_FAILED:slot${slot}:${lastErr?.message ?? 'unknown'}`);
  }

  if (oldIp && oldIp === newIp) {
    await logOperation({
      level: 'ERROR',
      message: `C-Rank 계정 전환 — IP 동일(${newIp}) 재할당, 세션 중단 (다른 계정 연속 사용 방지)`,
      ...logBase,
    });
    throw new Error(`MODEM_IP_ROTATE_SAME:slot${slot}:${newIp}`);
  }

  await logOperation({
    level: 'info',
    message: `계정 전환 IP 교체: ${oldIp ?? '?'} → ${newIp}`,
    ...logBase,
  });

  return true;
}
