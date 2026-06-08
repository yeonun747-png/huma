import { supabase } from '../middleware/auth.js';
import { redisConnection } from '../modules/queue/producer.js';
import { reconnectModemBySlot } from '../modules/modem/reconnect.js';
import { fetchPublicIpViaSocks } from './modem-geo.js';
import { proxyPortToSlot } from './modem-ports.js';
import { logOperation } from './log-emitter.js';
import { sleep } from './utils.js';

// IP 소유권 기록 — 만료되면 "소유 불명"이 되어 다른 계정이 같은 IP를 재사용할 수 있으므로
// 활동 주기(2~3일)보다 충분히 길게 유지한다.
const LAST_ACCOUNT_TTL_SEC = 7 * 86400;
const RECONNECT_ATTEMPTS = 3;

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

  const slot = proxyPortToSlot(proxyPort);
  const [{ data: modem }, { data: account }] = await Promise.all([
    supabase
      .from('huma_modems')
      .select('id, current_ip, public_ip, status')
      .eq('slot_number', slot)
      .single(),
    supabase.from('huma_accounts').select('name, crank_workspace').eq('id', accountId).single(),
  ]);

  assertModemSessionReady(modem?.status, slot);

  const currentIp = modem?.current_ip ?? null;
  // 교체 필요 = (다른 계정이 점유 || 소유 불명=기록 만료) && 이미 IP가 존재.
  // 같은 계정이 이어서 쓰거나(동일 IP 유지), IP 자체가 없는 최초 부팅만 교체를 생략한다.
  // → "현재 IP가 이 계정의 것임을 증명할 수 없으면 무조건 교체" 원칙으로 동일 IP 교차 사용을 차단.
  const needs = lastAccountId !== accountId && currentIp !== null;

  const logBase = {
    workspace: (account?.crank_workspace as string | undefined) ?? 'yeonun',
    platform: 'naver_crank',
    account_id: accountId,
    modem_id: modem?.id,
    metadata: { source: 'crank_session' },
  };

  if (!needs) {
    const ipNote = currentIp ?? '?';
    const message =
      lastAccountId === accountId
        ? `C-Rank 세션 시작 — 동일 계정·IP 유지 (${ipNote})`
        : `C-Rank 세션 시작 — :${proxyPort} 신규 IP (동글 첫 사용)`;
    await logOperation({ level: 'info', message, ...logBase });
    return false;
  }

  // RNDIS 사설 IP(192.168.x.100)는 link down/up 후에도 동일 — 공인 egress IP로 격리 판단
  const oldPublicIp =
    (modem?.public_ip as string | null | undefined) ?? (await fetchPublicIpViaSocks(proxyPort));
  let newPublicIp: string | undefined;
  let lastErr: Error | undefined;
  let publicIpUnchanged = false;

  for (let attempt = 1; attempt <= RECONNECT_ATTEMPTS; attempt++) {
    try {
      await reconnectModemBySlot(slot, { attempt });
      const fetched = await fetchPublicIpViaSocks(proxyPort);
      if (!fetched) {
        throw new Error(`:${proxyPort} SOCKS 공인 IP 확인 실패`);
      }
      if (!oldPublicIp || fetched !== oldPublicIp) {
        newPublicIp = fetched;
        break;
      }
      publicIpUnchanged = true;
      lastErr = new Error(`공인 IP 동일 (${fetched})`);
      if (attempt < RECONNECT_ATTEMPTS) {
        await sleep(6000 + attempt * 2000);
      }
    } catch (err) {
      lastErr = err as Error;
      if (attempt < RECONNECT_ATTEMPTS) {
        await sleep(4000);
      }
    }
  }

  if (!newPublicIp) {
    const message = publicIpUnchanged
      ? `C-Rank 계정 전환 — 공인 IP 동일(${oldPublicIp}) ${RECONNECT_ATTEMPTS}회 재시도 후 중단 (AT+CFUN·link disconnect 확인, /etc/huma/dongle-at-ports.conf)`
      : `C-Rank 계정 전환 — IP 교체 실패(${RECONNECT_ATTEMPTS}회), 세션 중단: ${lastErr?.message ?? 'unknown'}`;
    await logOperation({
      level: 'ERROR',
      message,
      ...logBase,
    });
    if (publicIpUnchanged) {
      throw new Error(`MODEM_IP_ROTATE_SAME:slot${slot}:${oldPublicIp}`);
    }
    throw new Error(`MODEM_IP_ROTATE_FAILED:slot${slot}:${lastErr?.message ?? 'unknown'}`);
  }

  await logOperation({
    level: 'info',
    message: `계정 전환 IP 교체: ${oldPublicIp ?? '?'} → ${newPublicIp}`,
    ...logBase,
  });

  return true;
}
