import { Redis } from 'ioredis';
import { Queue } from 'bullmq';
import { resolveRedisUrl } from '../../lib/redis-config.js';

const connection = new Redis(resolveRedisUrl(), {
  maxRetriesPerRequest: null,
});
export const humaQueue = new Queue('huma-jobs', { connection });

export async function enqueueJob(
  data: Record<string, unknown>,
  opts?: { delay?: number; jobId?: string; priority?: number },
) {
  return humaQueue.add(data.type as string, data, {
    delay: opts?.delay,
    jobId: opts?.jobId,
    priority: opts?.priority,
    removeOnComplete: 100,
    removeOnFail: 200,
  });
}

/** BullMQ jobId 중복 — 이미 대기·실행 중이면 false */
export async function tryEnqueueJob(
  data: Record<string, unknown>,
  opts?: { delay?: number; jobId?: string; priority?: number },
): Promise<boolean> {
  try {
    await enqueueJob(data, opts);
    return true;
  } catch (err) {
    const msg = (err as Error).message ?? '';
    if (/job.*already exists|JobId.*exist/i.test(msg)) return false;
    throw err;
  }
}

export { connection as redisConnection };
