import { humaQueue, redisConnection } from '../queue/producer.js';

const SCAN_LOCK_KEY = 'blog_check:scan_lock';
const SCAN_LOCK_TTL_SEC = 1800;
export const BLOG_CHECK_QUEUE_JOB_ID = 'blog-check-scan';

const ACTIVE_QUEUE_STATES = new Set(['active', 'waiting', 'delayed', 'prioritized']);

/** 완료·실패 job이 jobId를 점유하면 재스캔 enqueue가 거절됨 — 선제 제거 */
export async function clearFinishedBlogCheckQueueJob(): Promise<void> {
  try {
    const job = await humaQueue.getJob(BLOG_CHECK_QUEUE_JOB_ID);
    if (!job) return;
    const state = await job.getState();
    if (!ACTIVE_QUEUE_STATES.has(state)) {
      await job.remove();
    }
  } catch (err) {
    console.error('[blog-check] clear finished queue job failed:', err);
  }
}

export async function acquireBlogCheckScanLock(): Promise<boolean> {
  const ok = await redisConnection.set(SCAN_LOCK_KEY, String(Date.now()), 'EX', SCAN_LOCK_TTL_SEC, 'NX');
  return ok === 'OK';
}

export async function releaseBlogCheckScanLock(): Promise<void> {
  await redisConnection.del(SCAN_LOCK_KEY);
}

export async function isBlogCheckScanLockHeld(): Promise<boolean> {
  return (await redisConnection.exists(SCAN_LOCK_KEY)) === 1;
}

export async function hasActiveBlogCheckQueueJob(): Promise<boolean> {
  try {
    const job = await humaQueue.getJob(BLOG_CHECK_QUEUE_JOB_ID);
    if (!job) return false;
    const state = await job.getState();
    return ACTIVE_QUEUE_STATES.has(state);
  } catch {
    return false;
  }
}

/** API·큐 불일치 시 고착 lock 해제 (pm2 재시작·지연 job 등) */
export async function recoverStaleBlogCheckScanLock(): Promise<boolean> {
  const held = await isBlogCheckScanLockHeld();
  if (!held) return false;
  if (await hasActiveBlogCheckQueueJob()) return false;
  await releaseBlogCheckScanLock();
  return true;
}

export async function isBlogCheckScanLocked(): Promise<boolean> {
  await recoverStaleBlogCheckScanLock();
  if (await hasActiveBlogCheckQueueJob()) return true;
  return isBlogCheckScanLockHeld();
}
