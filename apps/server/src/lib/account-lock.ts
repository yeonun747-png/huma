import { randomUUID } from 'crypto';
import { redisConnection } from '../modules/queue/producer.js';

/**
 * 계정 동시 실행 방지 락 — Redis 기반(프로세스/머신 간 공유).
 * 규칙: 동일 계정이 두 작업에 동시에 쓰이지 않도록 직렬화.
 * 프로세스 crash 시 TTL로 자동 해제(stale-running 복구 윈도우와 정렬).
 */

// 정상 세션(crank 45분·posting 30분)을 덮되, stale-running 복구(150분)보다 짧게 잡아
// crash 후 복구 재실행이 동일 계정을 다시 획득할 수 있게 한다. graceful shutdown이 1차 해제.
const ACCOUNT_LOCK_TTL_SEC = 60 * 60;
const OWNER = `${process.pid}-${randomUUID()}`;

function lockKey(accountId: string): string {
  return `account_lock:${accountId}`;
}

/** 소유자가 일치할 때만 삭제 — 다른 프로세스의 락을 잘못 해제하지 않음 */
const RELEASE_LUA = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
end
return 0
`;

export async function acquireAccount(accountId: string): Promise<boolean> {
  const res = await redisConnection.set(
    lockKey(accountId),
    OWNER,
    'EX',
    ACCOUNT_LOCK_TTL_SEC,
    'NX',
  );
  return res === 'OK';
}

export async function releaseAccount(accountId: string): Promise<void> {
  try {
    await redisConnection.eval(RELEASE_LUA, 1, lockKey(accountId), OWNER);
  } catch {
    // best-effort: TTL이 결국 해제
  }
}

export async function isAccountBusy(accountId: string): Promise<boolean> {
  return (await redisConnection.exists(lockKey(accountId))) === 1;
}
