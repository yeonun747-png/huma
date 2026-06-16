import { redisConnection } from '../queue/producer.js';

const SCAN_LOCK_KEY = 'blog_check:scan_lock';
const SCAN_LOCK_TTL_SEC = 1800;

export async function acquireBlogCheckScanLock(): Promise<boolean> {
  const ok = await redisConnection.set(SCAN_LOCK_KEY, String(Date.now()), 'EX', SCAN_LOCK_TTL_SEC, 'NX');
  return ok === 'OK';
}

export async function releaseBlogCheckScanLock(): Promise<void> {
  await redisConnection.del(SCAN_LOCK_KEY);
}

export async function isBlogCheckScanLocked(): Promise<boolean> {
  return (await redisConnection.exists(SCAN_LOCK_KEY)) === 1;
}
