import { redisConnection } from '../modules/queue/producer.js';

/**
 * 로그인 brute-force 완화 — IP+계정 기준 시도 횟수 제한.
 * 윈도우 내 임계 초과 시 차단. Redis INCR + TTL로 원자적 카운트.
 */

const WINDOW_SEC = 15 * 60;
const MAX_ATTEMPTS = 10;

function attemptKey(scope: string): string {
  return `login_attempts:${scope}`;
}

/** 차단 상태면 남은 차단 시간(초)을 반환, 아니면 0 */
export async function checkLoginBlocked(ip: string, loginId: string): Promise<number> {
  const keys = [attemptKey(`ip:${ip}`), attemptKey(`id:${loginId}`)];
  let maxTtl = 0;
  for (const key of keys) {
    const count = Number((await redisConnection.get(key)) ?? 0);
    if (count >= MAX_ATTEMPTS) {
      const ttl = await redisConnection.ttl(key);
      if (ttl > maxTtl) maxTtl = ttl;
    }
  }
  return maxTtl;
}

export async function recordLoginFailure(ip: string, loginId: string): Promise<void> {
  for (const key of [attemptKey(`ip:${ip}`), attemptKey(`id:${loginId}`)]) {
    const count = await redisConnection.incr(key);
    if (count === 1) await redisConnection.expire(key, WINDOW_SEC);
  }
}

export async function clearLoginFailures(ip: string, loginId: string): Promise<void> {
  await redisConnection.del(attemptKey(`ip:${ip}`), attemptKey(`id:${loginId}`));
}
