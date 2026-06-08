import { redisConnection } from '../modules/queue/producer.js';

const PROGRESS_TTL_SEC = 2 * 3600;

function progressKey(jobId: string): string {
  return `crank_progress:${jobId}`;
}

export type CrankSessionProgress = {
  phase: string;
  detail?: string;
  at: number;
};

export async function setCrankSessionProgress(
  jobId: string | undefined,
  phase: string,
  detail?: string,
): Promise<void> {
  if (!jobId) return;
  const payload: CrankSessionProgress = { phase, detail, at: Date.now() };
  await redisConnection.set(progressKey(jobId), JSON.stringify(payload), 'EX', PROGRESS_TTL_SEC);
}

export async function getCrankSessionProgress(jobId: string): Promise<CrankSessionProgress | null> {
  const raw = await redisConnection.get(progressKey(jobId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CrankSessionProgress;
  } catch {
    return null;
  }
}

export async function clearCrankSessionProgress(jobId: string | undefined): Promise<void> {
  if (!jobId) return;
  await redisConnection.del(progressKey(jobId));
}
