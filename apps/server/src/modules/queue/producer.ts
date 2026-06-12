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

export { connection as redisConnection };
