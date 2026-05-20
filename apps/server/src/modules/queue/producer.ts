import { Redis } from 'ioredis';
import { Queue } from 'bullmq';

const connection = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

export const humaQueue = new Queue('huma-jobs', { connection });

export async function enqueueJob(data: Record<string, unknown>, opts?: { delay?: number; jobId?: string }) {
  return humaQueue.add(data.type as string, data, {
    delay: opts?.delay,
    jobId: opts?.jobId,
    removeOnComplete: 100,
    removeOnFail: 50,
  });
}

export { connection as redisConnection };
