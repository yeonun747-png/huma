import { supabase } from '../middleware/auth.js';
import { normalizePostUrlKey } from '../modules/blog-check/blog-url.js';
import { formatKstDateKey } from './posting-daily-target.js';

export const RECONCILE_PUBLISH_AT_KEY = '_reconcile_publish_at';
export const RECONCILED_FROM_FAILED_KEY = '_reconciled_from_failed';
/** post_blog 등록 시 네이버 예약 발행 시각 — CAPTCHA/앞당기기로 scheduled_at이 바뀌어도 유지 */
export const PUBLISH_SCHEDULED_AT_KEY = '_publish_scheduled_at';

const COMPLETION_STAMP_MS = 15 * 60_000;

/** completed_at과 같거나, 완료보다 늦은 시각 — 예약 발행일로 쓰면 안 됨 */
export function isUntrustedPublishTimestamp(
  candidate: string | null | undefined,
  completedAt: string | null | undefined,
): boolean {
  if (!candidate?.trim()) return true;
  const a = new Date(candidate).getTime();
  if (!Number.isFinite(a)) return true;
  if (!completedAt?.trim()) return false;
  const b = new Date(completedAt).getTime();
  if (!Number.isFinite(b)) return false;
  if (Math.abs(a - b) < COMPLETION_STAMP_MS) return true;
  return a > b + 5 * 60_000;
}

/** @deprecated use isUntrustedPublishTimestamp */
export function isWorkerCompletionStamp(
  candidate: string,
  completedAt: string | null | undefined,
): boolean {
  return isUntrustedPublishTimestamp(candidate, completedAt);
}

export function resolveStoredPublishScheduledAt(
  platformSchedule: unknown,
  completedAt?: string | null,
): string | null {
  const ps = (platformSchedule as Record<string, unknown> | null) ?? {};
  const reconcile =
    typeof ps[RECONCILE_PUBLISH_AT_KEY] === 'string' ? (ps[RECONCILE_PUBLISH_AT_KEY] as string) : null;
  const reserved =
    typeof ps[PUBLISH_SCHEDULED_AT_KEY] === 'string' ? (ps[PUBLISH_SCHEDULED_AT_KEY] as string) : null;

  const pickReconcile = (iso: string | null | undefined) => {
    if (!iso?.trim()) return null;
    if (isUntrustedPublishTimestamp(iso, completedAt ?? null)) return null;
    return iso;
  };
  const pickReserved = (iso: string | null | undefined) => (iso?.trim() ? iso : null);

  return pickReserved(reserved) ?? pickReconcile(reconcile);
}

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
  scheduled_at?: string | null;
  platform_schedule: unknown;
};

/** post_blog scheduled_at 컬럼 */
export function resolveWorkerPublishAtIso(job: { scheduled_at?: string | null }): string | null {
  const scheduled = job.scheduled_at?.trim();
  if (!scheduled) return null;
  const t = new Date(scheduled).getTime();
  if (!Number.isFinite(t)) return null;
  return scheduled;
}

export function resolveFinalizePublishAtIso(job: {
  scheduled_at?: string | null;
  completed_at?: string | null;
  platform_schedule?: unknown;
}): string {
  const stored = resolveStoredPublishScheduledAt(job.platform_schedule, job.completed_at ?? null);
  if (stored) return stored;
  const scheduled = resolveWorkerPublishAtIso(job);
  if (scheduled && !isUntrustedPublishTimestamp(scheduled, job.completed_at ?? null)) return scheduled;
  return new Date().toISOString();
}

/** 일일 집계·revert 판단용 — 네이버 실제 발행 시각 우선 */
export function resolveJobPublishedAtIso(
  job: JobPublishRow,
  postPublishedByUrl?: Map<string, string | null>,
): string | null {
  const ps = (job.platform_schedule as Record<string, unknown> | null) ?? {};
  const stored = resolveStoredPublishScheduledAt(ps, job.completed_at);
  if (stored) return stored;

  const urlKey = job.result_url?.trim() ? normalizePostUrlKey(job.result_url) : '';
  if (urlKey && postPublishedByUrl?.has(urlKey)) {
    const fromPost = postPublishedByUrl.get(urlKey);
    if (fromPost && !isUntrustedPublishTimestamp(fromPost, job.completed_at)) return fromPost;
  }

  const scheduledAt = resolveWorkerPublishAtIso(job);
  if (scheduledAt && !isUntrustedPublishTimestamp(scheduledAt, job.completed_at)) return scheduledAt;

  if (ps[RECONCILED_FROM_FAILED_KEY] === true) return null;

  const completed = job.completed_at?.trim();
  if (completed && !isUntrustedPublishTimestamp(completed, completed)) return completed;
  return null;
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
    .select('id, result_url, completed_at, scheduled_at, platform_schedule')
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

export type PublishDayExplainRow = {
  job_id: string;
  title: string | null;
  result_url: string | null;
  completed_at: string | null;
  scheduled_at: string | null;
  reconcile_publish_at: string | null;
  publish_scheduled_at: string | null;
  posts_published_at: string | null;
  resolved_publish_at: string | null;
  resolved_publish_kst: string | null;
  counts_today: boolean;
};

/** 집계 디버그 — 서버가 실제로 쓰는 resolveJobPublishedAtIso 그대로 */
export async function explainPostBlogPublishDay(
  accountId: string,
  now = new Date(),
): Promise<{ kst_today: string; today_count: number; jobs: PublishDayExplainRow[] }> {
  const key = accountId.trim();
  const kstToday = formatKstDateKey(now);

  const { data: jobs, error } = await supabase
    .from('huma_jobs')
    .select('id, title, result_url, completed_at, scheduled_at, platform_schedule')
    .eq('account_id', key)
    .eq('job_type', 'post_blog')
    .eq('status', 'completed')
    .not('result_url', 'is', null);

  if (error) throw new Error(`집계 디버그 실패: ${error.message}`);
  if (!jobs?.length) {
    return { kst_today: kstToday, today_count: 0, jobs: [] };
  }

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

  const rows: PublishDayExplainRow[] = [];
  let todayCount = 0;
  for (const job of jobs) {
    const ps = (job.platform_schedule as Record<string, unknown> | null) ?? {};
    const urlKey = job.result_url?.trim() ? normalizePostUrlKey(job.result_url) : '';
    const postsAt = urlKey && postPublishedByUrl.has(urlKey) ? postPublishedByUrl.get(urlKey) : null;
    const resolved = resolveJobPublishedAtIso(job, postPublishedByUrl);
    const countsToday = isPublishedTodayKst(resolved, now);
    if (countsToday) todayCount += 1;
    rows.push({
      job_id: job.id as string,
      title: (job.title as string | null) ?? null,
      result_url: job.result_url as string,
      completed_at: (job.completed_at as string | null) ?? null,
      scheduled_at: (job.scheduled_at as string | null) ?? null,
      reconcile_publish_at:
        typeof ps[RECONCILE_PUBLISH_AT_KEY] === 'string' ? (ps[RECONCILE_PUBLISH_AT_KEY] as string) : null,
      publish_scheduled_at:
        typeof ps[PUBLISH_SCHEDULED_AT_KEY] === 'string' ? (ps[PUBLISH_SCHEDULED_AT_KEY] as string) : null,
      posts_published_at: postsAt ?? null,
      resolved_publish_at: resolved,
      resolved_publish_kst: resolved ? formatKstDateKey(new Date(resolved)) : null,
      counts_today: countsToday,
    });
  }

  return { kst_today: kstToday, today_count: todayCount, jobs: rows };
}
