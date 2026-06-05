import { supabase } from '../../middleware/auth.js';
import { redisConnection } from '../queue/producer.js';
import {
  CRANK_PROXY_PORTS,
  CRANK_SCHEDULED_LOCK_TTL_SEC,
  MODEM_LOCK_TTL_SEC,
} from '../../lib/modem-ports.js';
import { getSchedulableCrankProxyPorts } from '../../lib/crank-modems.js';
import { shuffleArray } from '../../lib/utils.js';

function crankLockKey(port: number) {
  return `modem_lock:${port}`;
}

function postingLockKey(port: number) {
  return `modem_lock:posting:${port}`;
}

/** Redis 기준 유휴 C-Rank SOCKS 슬롯 수 (세션 시작 전 선확인용) */
export async function countIdleCrankModemSlots(): Promise<number> {
  const crankPorts = await getSchedulableCrankProxyPorts();
  const portPool = crankPorts.length > 0 ? crankPorts : [...CRANK_PROXY_PORTS];
  let idle = 0;
  for (const port of portPool) {
    const crankLock = await redisConnection.get(crankLockKey(port));
    const postingLock = await redisConnection.get(postingLockKey(port));
    if (!crankLock && !postingLock) idle++;
  }
  return idle;
}

export async function hasIdleCrankModem(): Promise<boolean> {
  return (await countIdleCrankModemSlots()) > 0;
}

/** v3.22 §7-13-1 — posting: DB 고정 / crank: Redis 유휴 슬롯 동적 할당 */
export async function getModemProxyPort(
  accountId: string,
  opts?: { lockTtlSec?: number },
): Promise<number> {
  const lockTtl = opts?.lockTtlSec ?? MODEM_LOCK_TTL_SEC;
  const { data: account } = await supabase
    .from('huma_accounts')
    .select('proxy_port, account_type')
    .eq('id', accountId)
    .single();

  if (!account) {
    throw new Error(`[getModemProxyPort] 계정 없음: ${accountId}`);
  }

  if (account.account_type === 'posting') {
    if (!account.proxy_port) {
      throw new Error('[getModemProxyPort] posting 계정 proxy_port 미설정 (10001~10004)');
    }
    const port = account.proxy_port;
    const crankUsing = await redisConnection.get(crankLockKey(port));
    if (crankUsing) {
      throw new Error(`[getModemProxyPort] posting 포트 ${port} C-Rank 사용 중 (규칙 ⑬)`);
    }
    await redisConnection.set(postingLockKey(port), accountId, 'EX', lockTtl);
    return port;
  }

  const crankPorts = await getSchedulableCrankProxyPorts();
  const portPool =
    crankPorts.length > 0 ? crankPorts : [...CRANK_PROXY_PORTS];

  for (const port of shuffleArray(portPool)) {
    const acquired = await redisConnection.set(
      crankLockKey(port),
      accountId,
      'EX',
      lockTtl,
      'NX',
    );
    if (acquired !== 'OK') continue;

    const postingLock = await redisConnection.get(postingLockKey(port));
    if (postingLock) {
      await redisConnection.del(crankLockKey(port));
      continue;
    }
    return port;
  }

  throw new Error(`[getModemProxyPort] 유휴 C-Rank 동글 없음. accountId=${accountId}`);
}

/** v3.22 §7-13-1 — 세션 종료 시 Redis 락 해제 */
export async function releaseModemLocks(port: number, kind: 'posting' | 'crank'): Promise<void> {
  if (kind === 'posting') {
    await redisConnection.del(postingLockKey(port));
  } else {
    await redisConnection.del(crankLockKey(port));
  }
}
