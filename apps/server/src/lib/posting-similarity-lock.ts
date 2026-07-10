import { randomUUID } from 'node:crypto';

import { redisConnection } from '../modules/queue/producer.js';

const LOCK_TTL_MS = 15 * 60 * 1000;

function lockKey(workspace: string): string {
  return `posting_similarity_lock:ws:${workspace.trim()}`;
}

/**
 * 동일 워크스페이스 동시 content_full 생성 — 제목 코퍼스 레이스 방지
 * (제목은 워크스페이스 전체 비교이므로 계정 단위 락으로는 부족)
 */
export async function withPostingSimilarityLock<T>(
  workspace: string,
  fn: () => Promise<T>,
): Promise<T> {
  const key = workspace.trim();
  if (!key) return fn();

  const token = randomUUID();
  const redisKey = lockKey(key);
  const acquired = await redisConnection.set(redisKey, token, 'PX', LOCK_TTL_MS, 'NX');
  if (acquired !== 'OK') {
    throw new Error('동일 워크스페이스 포스팅 생성이 진행 중입니다 — 잠시 후 재시도하세요');
  }

  try {
    return await fn();
  } finally {
    const current = await redisConnection.get(redisKey);
    if (current === token) {
      await redisConnection.del(redisKey);
    }
  }
}
