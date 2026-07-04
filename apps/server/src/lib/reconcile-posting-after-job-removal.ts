import { replanAutoPublishSlot } from './auto-publish-state.js';
import { countInFlightPostingPipeline } from './posting-daily-status.js';
import { clearOrphanPostingReservations } from './posting-quota-reserve.js';

const POSTING_PIPELINE_JOB_TYPES = new Set(['content_full', 'post_blog']);

export function isPostingPipelineJobType(jobType: string): boolean {
  return POSTING_PIPELINE_JOB_TYPES.has(jobType);
}

export type PostingReconcileTarget = { accountId: string; workspace: string };

/** 포스팅 파이프라인 job 제거 후 고아 예약 해제 + 자동발행 다음 슬롯 재계획 */
export async function reconcilePostingAfterJobRemoval(
  targets: PostingReconcileTarget[],
): Promise<void> {
  const seen = new Set<string>();
  for (const { accountId, workspace } of targets) {
    const key = `${accountId}:${workspace}`;
    if (!accountId?.trim() || !workspace?.trim() || seen.has(key)) continue;
    seen.add(key);

    const pipelineJobs = await countInFlightPostingPipeline(accountId);
    await clearOrphanPostingReservations(accountId, pipelineJobs).catch(() => undefined);
    await replanAutoPublishSlot(accountId, workspace).catch(() => undefined);
  }
}
