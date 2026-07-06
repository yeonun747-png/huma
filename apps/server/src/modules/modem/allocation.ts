import { supabase } from '../../middleware/auth.js';
import { redisConnection } from '../queue/producer.js';
import {
  CRANK_PROXY_PORTS,
  POSTING_LOCK_TTL_SEC,
  CRANK_ADHOC_LOCK_TTL_SEC,
} from '../../lib/modem-ports.js';
import { getSchedulableCrankProxyPorts } from '../../lib/crank-modems.js';
import { logOperation } from '../../lib/log-emitter.js';
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
  if (crankPorts.length === 0) return 0;
  let idle = 0;
  for (const port of crankPorts) {
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
  opts?: { lockTtlSec?: number; preferredProxyPort?: number },
): Promise<number> {
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
    const postingTtl = opts?.lockTtlSec ?? POSTING_LOCK_TTL_SEC;
    const crankUsing = await redisConnection.get(crankLockKey(port));
    if (crankUsing) {
      throw new Error(`[getModemProxyPort] posting 포트 ${port} C-Rank 사용 중 (규칙 ⑬)`);
    }
    // NX로 동일 포트(=물리 동글)에 두 번째 세션이 끼어드는 것을 차단.
    const acquired = await redisConnection.set(
      postingLockKey(port),
      accountId,
      'EX',
      postingTtl,
      'NX',
    );
    if (acquired !== 'OK') {
      const holder = await redisConnection.get(postingLockKey(port));
      if (holder && holder !== accountId) {
        throw new Error(`[getModemProxyPort] posting 포트 ${port} 다른 계정 사용 중 (holder=${holder})`);
      }
      // 동일 계정 재진입/락 갱신 (account-lock으로 계정 단위는 이미 직렬화됨)
      await redisConnection.set(postingLockKey(port), accountId, 'EX', postingTtl);
    }
    return port;
  }

  const crankTtl = opts?.lockTtlSec ?? CRANK_ADHOC_LOCK_TTL_SEC;
  const crankPorts = await getSchedulableCrankProxyPorts();
  if (crankPorts.length === 0) {
    throw new Error(`[getModemProxyPort] 유휴 C-Rank 동글 없음. accountId=${accountId}`);
  }
  const portPool = crankPorts;

  const tryAcquirePort = async (port: number): Promise<number | null> => {
    if (!portPool.includes(port)) return null;
    const acquired = await redisConnection.set(
      crankLockKey(port),
      accountId,
      'EX',
      crankTtl,
      'NX',
    );
    if (acquired !== 'OK') return null;
    const postingLock = await redisConnection.get(postingLockKey(port));
    if (postingLock) {
      await redisConnection.del(crankLockKey(port));
      return null;
    }
    return port;
  };

  if (opts?.preferredProxyPort) {
    const preferred = await tryAcquirePort(opts.preferredProxyPort);
    if (preferred) return preferred;
    await logOperation({
      level: 'warn',
      message: `[crank] 스케줄 트랙 :${opts.preferredProxyPort} 사용 중 — 유휴 동글 fallback`,
      account_id: accountId,
    });
    for (const port of shuffleArray(portPool)) {
      if (port === opts.preferredProxyPort) continue;
      const acquired = await tryAcquirePort(port);
      if (acquired) return acquired;
    }
    throw new Error(`[getModemProxyPort] 유휴 C-Rank 동글 없음. accountId=${accountId}`);
  }

  for (const port of shuffleArray(portPool)) {
    const acquired = await tryAcquirePort(port);
    if (acquired) return acquired;
  }

  throw new Error(`[getModemProxyPort] 유휴 C-Rank 동글 없음. accountId=${accountId}`);
}

/** worker crash 후 Redis crank lock 잔존 → running job 없으면 해제 */
export async function reconcileStaleCrankModemLocks(): Promise<number> {
  const { data: runningJobs } = await supabase
    .from('huma_jobs')
    .select('account_id')
    .eq('job_type', 'social_crank')
    .eq('status', 'running');

  const activeAccounts = new Set(
    (runningJobs ?? []).map((j) => j.account_id).filter(Boolean) as string[],
  );

  const crankPorts = await getSchedulableCrankProxyPorts();
  const portPool = crankPorts.length > 0 ? crankPorts : [...CRANK_PROXY_PORTS];
  let cleared = 0;

  for (const port of portPool) {
    const holder = await redisConnection.get(crankLockKey(port));
    if (!holder) continue;
    if (activeAccounts.has(holder)) continue;
    await redisConnection.del(crankLockKey(port));
    // crash로 DB status가 'busy'에 고착되면 대시보드·스케줄 표시가 어긋난다 → idle 복구
    await supabase
      .from('huma_modems')
      .update({ status: 'idle' })
      .eq('proxy_port', port)
      .eq('status', 'busy');
    await logOperation({
      level: 'warn',
      message: `[crank] stale modem lock cleared :${port} (holder=${holder})`,
    });
    cleared++;
  }
  return cleared;
}

/** v3.22 §7-13-1 — 세션 종료 시 Redis 락 해제 */
export async function releaseModemLocks(port: number, kind: 'posting' | 'crank'): Promise<void> {
  if (kind === 'posting') {
    await redisConnection.del(postingLockKey(port));
  } else {
    await redisConnection.del(crankLockKey(port));
  }
}
