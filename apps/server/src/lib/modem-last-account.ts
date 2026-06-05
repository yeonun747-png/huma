import { supabase } from '../middleware/auth.js';
import { redisConnection } from '../modules/queue/producer.js';
import { reconnectModemBySlot } from '../modules/modem/reconnect.js';
import { proxyPortToSlot } from './modem-ports.js';
import { logOperation } from './log-emitter.js';
import { sleep } from './utils.js';

/**
 * 규칙 ⑦ — 모뎀 물리 재연결 성공 후 다음 계정 세션 시작 전 대기 (네이버 탐지 회피).
 * IP 재할당용 sleep(5000)은 reconnectModemBySlot 내부 기술적 대기와 별개 맥락.
 */
const POST_RECONNECT_SESSION_WAIT_MS =
  Number(process.env.HUMA_CRANK_RECONNECT_WAIT_MS) || 10 * 60 * 1000;

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

/**
 * v3.30 C-Rank — 다른 계정이 쓰던 동글이면 비행기모드 1회 시도.
 * - 성공 + IP 동일: 재시도 없이 진행 → 규칙 ⑦ 10분 대기 후 세션 시작
 * - 실패(sudo 등): WARN 로그 후 이전 IP 유지 채로 진행 (C-Rank만; 카페는 별도 rotateCafeSession)
 */
export async function reconnectModemIfAccountSwitched(
  proxyPort: number,
  accountId: string,
): Promise<boolean> {
  const lastAccountId = await redisConnection.get(lastAccountKey(proxyPort));
  const needs = lastAccountId !== null && lastAccountId !== accountId;
  if (!needs) return false;

  const slot = proxyPortToSlot(proxyPort);
  const { data: modem } = await supabase
    .from('huma_modems')
    .select('id, current_ip')
    .eq('slot_number', slot)
    .single();

  const oldIp = modem?.current_ip ?? null;
  let newIp: string;
  try {
    // reconnectModemBySlot 내부 sleep(5000) = IP 재할당 완료 대기 (기술적)
    newIp = await reconnectModemBySlot(slot);
  } catch (err) {
    await logOperation({
      level: 'WARN',
      message: `C-Rank 계정 전환 — 비행기모드 재연결 실패, 이전 IP(${oldIp ?? '?'}) 유지 후 세션 진행: ${(err as Error).message}`,
      modem_id: modem?.id,
      account_id: accountId,
    });
    return false;
  }

  const sameIp = Boolean(oldIp && oldIp === newIp);
  await logOperation({
    level: 'info',
    message: sameIp
      ? `계정 전환 IP 교체 시도 — 동일 IP(${newIp}) 재할당, 정상 진행`
      : `계정 전환 IP 교체: ${oldIp ?? '?'} → ${newIp}`,
    modem_id: modem?.id,
    account_id: accountId,
  });

  if (POST_RECONNECT_SESSION_WAIT_MS > 0) {
    await sleep(POST_RECONNECT_SESSION_WAIT_MS);
  }

  return true;
}
