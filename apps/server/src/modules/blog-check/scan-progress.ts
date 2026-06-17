import { redisConnection } from '../queue/producer.js';

const PROGRESS_KEY = 'blog_check:scan_progress';
const PROGRESS_TTL_SEC = 1800;

export interface BlogCheckScanProgress {
  accountId: string | null;
  accountLabel: string | null;
  completed: number;
  total: number;
  percent: number;
  phase: 'preparing' | 'scanning' | 'done';
}

export async function setScanProgress(progress: BlogCheckScanProgress): Promise<void> {
  try {
    await redisConnection.set(PROGRESS_KEY, JSON.stringify(progress), 'EX', PROGRESS_TTL_SEC);
  } catch (err) {
    console.error('[blog-check] scan progress set failed:', err);
  }
}

export async function getScanProgress(): Promise<BlogCheckScanProgress | null> {
  try {
    const raw = await redisConnection.get(PROGRESS_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as BlogCheckScanProgress;
  } catch {
    return null;
  }
}

export async function clearScanProgress(): Promise<void> {
  try {
    await redisConnection.del(PROGRESS_KEY);
  } catch {
    /* ignore */
  }
}
