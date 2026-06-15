import { collectDeletableMediaPaths, deleteHumaMediaPaths } from './huma-media-storage.js';
import { logOperation } from './log-emitter.js';

/** post_blog 발행 성공 후 huma-media(jobs/*, images/*) 정리 */
export async function purgePostBlogStorageMedia(
  imageUrls: string[] | null | undefined,
  opts?: { jobId?: string; accountId?: string },
): Promise<void> {
  const paths = collectDeletableMediaPaths(imageUrls);
  if (!paths.length) return;

  try {
    const result = await deleteHumaMediaPaths(paths);
    await logOperation({
      level: result.failed.length ? 'warn' : 'info',
      message: `[post_blog] Storage 이미지 삭제 ${result.deleted}/${paths.length}${
        result.failed.length ? ` · 실패 ${result.failed.length}` : ''
      }`,
      job_id: opts?.jobId,
      account_id: opts?.accountId,
    }).catch(() => {});
  } catch (err) {
    await logOperation({
      level: 'warn',
      message: `[post_blog] Storage 이미지 삭제 오류: ${(err as Error).message}`,
      job_id: opts?.jobId,
      account_id: opts?.accountId,
    }).catch(() => {});
  }
}
