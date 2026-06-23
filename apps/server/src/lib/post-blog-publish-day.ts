import { supabase } from '../middleware/auth.js';
import { normalizePostUrlKey } from '../modules/blog-check/blog-url.js';
import { formatKstDateKey } from './posting-daily-target.js';

export const RECONCILE_PUBLISH_AT_KEY = '_reconcile_publish_at';
export const RECONCILED_FROM_FAILED_KEY = '_reconciled_from_failed';

/** KST 기준 해당 시각이 오늘 발행인지 */
export function isPublishedTodayKst(iso: string | null | undefined, now = new Date()): boolean {
  if (!iso?.trim()) return false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  return formatKstDateKey(d) === formatKstDateKey(now);
}

type JobPublishRow = {
  result_url: string | null;
  completed_at: string | null;
  platform_schedule: unknown;
};

/** 일일 집계·revert 판단용 — 네이버 실제 발행 시각 우선 */
export function resolveJobPublishedAtIso(
  job: JobPublishRow,
  postPublishedByUrl?: Map<string, string | null>,
): string | null {
  const ps = (job.platform_schedule as Record<string, unknown> | null) ?? {};
  const reconcileAt =
    typeof ps[RECONCILE_PUBLISH_AT_KEY] === 'string' ? (ps[RECONCILE_PUBLISH_AT_KEY] as string) : null;
  if (reconcileAt?.trim()) return reconcileAt;

  const urlKey = job.result_url?.trim() ? normalizePostUrlKey(job.result_url) : '';
  if (urlKey && postPublishedByUrl?.has(urlKey)) {
    const fromPost = postPublishedByUrl.get(urlKey);
    if (fromPost) return fromPost;
  }

  if (ps[RECONCILED_FROM_FAILED_KEY] === true) return null;

  return job.completed_at?.trim() || null;
}

export function isReconciledFromFailed(platformSchedule: unknown): boolean {
  const ps = (platformSchedule as Record<string, unknown> | null) ?? {};
  return ps[RECONCILED_FROM_FAILED_KEY] === true;
}

/** 오늘(KST) 실제 발행된 post_blog completed 건수 — completed_at이 아닌 발행일 기준 */
export async function countTodayPostBlogPublished(accountId: string): Promise<number> {
  const key = accountId.trim();
  if (!key) return 0;

  const { data: jobs, error } = await supabase
    .from('huma_jobs')
    .select('id, result_url, completed_at, platform_schedule')
    .eq('account_id', key)
    .eq('job_type', 'post_blog')
    .eq('status', 'completed')
    .not('result_url', 'is', null);

  if (error) throw new Error(`오늘 발행 집계 실패: ${error.message}`);
  if (!jobs?.length) return 0;

  const urlKeys = [
    ...new Set(jobs.map((j) => j.result_url).filter((u): u is string => Boolean(u?.trim())).map(normalizePostUrlKey)),
  ];

  const postPublishedByUrl = new Map<string, string | null>();
  if (urlKeys.length) {
    const { data: postRows } = await supabase
      .from('posts')
      .select('post_url, published_at')
      .eq('account_id', key);
    for (const row of postRows ?? []) {
      const k = normalizePostUrlKey(String(row.post_url ?? ''));
      if (k && urlKeys.includes(k) && row.published_at) {
        postPublishedByUrl.set(k, row.published_at as string);
      }
    }
  }

  let count = 0;
  for (const job of jobs) {
    const publishedAt = resolveJobPublishedAtIso(job, postPublishedByUrl);
    if (isPublishedTodayKst(publishedAt)) count += 1;
  }
  return count;
}
