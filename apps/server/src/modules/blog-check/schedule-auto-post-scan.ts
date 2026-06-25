import { humaQueue, tryEnqueueJob } from '../queue/producer.js';
import { logOperation } from '../../lib/log-emitter.js';
import { BLOG_CHECK_AUTO_SCAN_AFTER_PUBLISH_MS } from './constants.js';

export function autoBlogPostScanJobId(accountId: string, postNo: string): string {
  return `blog-check-auto-${accountId}-${postNo}`;
}

/** 발행 시각 기준 10분 후까지 남은 ms */
export function computeAutoBlogPostScanDelayMs(publishedAt: string, nowMs = Date.now()): number {
  const anchor = Date.parse(publishedAt);
  if (!Number.isFinite(anchor)) return BLOG_CHECK_AUTO_SCAN_AFTER_PUBLISH_MS;
  return Math.max(0, anchor + BLOG_CHECK_AUTO_SCAN_AFTER_PUBLISH_MS - nowMs);
}

/** post_blog 발행 직후 — 미스캔 버튼 대신 10분 뒤 단건 스캔 예약 */
export async function scheduleAutoBlogPostScan(input: {
  accountId: string;
  postNo: string;
  publishedAt: string;
}): Promise<void> {
  const postNo = input.postNo.trim();
  const accountId = input.accountId.trim();
  if (!postNo || !accountId) return;

  const delay = computeAutoBlogPostScanDelayMs(input.publishedAt);
  const jobId = autoBlogPostScanJobId(accountId, postNo);
  await cancelScheduledAutoBlogPostScan(accountId, postNo);
  const queued = await tryEnqueueJob(
    {
      type: 'blog_check',
      payload: {
        accountId,
        mode: 'posts',
        postNos: [postNo],
        autoScheduled: true,
      },
    },
    { delay, jobId },
  );

  if (queued) {
    await logOperation({
      level: 'info',
      message: `[blog-check] 발행+10분 자동 스캔 예약 — postNo=${postNo} (${Math.round(delay / 1000)}초 후)`,
      account_id: accountId,
    }).catch(() => undefined);
  }
}

/** 운영자가 「미스캔」 수동 클릭 시 지연 job 제거 */
export async function cancelScheduledAutoBlogPostScan(
  accountId: string,
  postNo: string,
): Promise<void> {
  const jobId = autoBlogPostScanJobId(accountId.trim(), postNo.trim());
  if (!accountId.trim() || !postNo.trim()) return;
  try {
    const job = await humaQueue.getJob(jobId);
    if (!job) return;
    const state = await job.getState();
    if (state === 'delayed' || state === 'waiting') {
      await job.remove();
    }
  } catch {
    /* noop */
  }
}
