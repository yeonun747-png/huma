import { supabase } from '../middleware/auth.js';
import { normalizePostUrlKey } from '../modules/blog-check/blog-url.js';
import { resolveJobPublishedAtIso } from './post-blog-publish-day.js';
import { formatKstDateKey } from './posting-daily-target.js';

const MAX_WARMUP_DAY = 30;

function kstTodayKey(now = new Date()): string {
  return formatKstDateKey(now);
}

/** 하루 1회 warmup_day +1 — C-Rank·post_blog 공용 */
export async function maybeIncrementWarmupDay(accountId: string): Promise<void> {
  const today = kstTodayKey();
  const { data: account } = await supabase
    .from('huma_accounts')
    .select('warmup_day, warmup_last_increment_date')
    .eq('id', accountId)
    .single();

  if (!account) return;
  if (account.warmup_last_increment_date === today) return;
  if ((account.warmup_day ?? 0) >= MAX_WARMUP_DAY) return;

  await supabase
    .from('huma_accounts')
    .update({
      warmup_day: (account.warmup_day ?? 0) + 1,
      warmup_last_increment_date: today,
    })
    .eq('id', accountId);
}

type PostBlogWarmupJob = {
  result_url: string | null;
  completed_at: string | null;
  scheduled_at?: string | null;
  platform_schedule: unknown;
};

/** 워밍업 일차 집계 — 발행 시각 우선, 없으면 scheduled_at·completed_at(KST) fallback */
export function resolveWarmupPublishKstDateKey(
  job: PostBlogWarmupJob,
  postPublishedByUrl?: Map<string, string | null>,
): string | null {
  const publishedAt = resolveJobPublishedAtIso(job, postPublishedByUrl);
  if (publishedAt?.trim()) {
    const d = new Date(publishedAt);
    if (!Number.isNaN(d.getTime())) return formatKstDateKey(d);
  }

  const scheduled = job.scheduled_at?.trim();
  if (scheduled) {
    const d = new Date(scheduled);
    if (!Number.isNaN(d.getTime())) return formatKstDateKey(d);
  }

  const completed = job.completed_at?.trim();
  if (completed) {
    const d = new Date(completed);
    if (!Number.isNaN(d.getTime())) return formatKstDateKey(d);
  }

  return null;
}

/** 완료된 post_blog의 KST 발행일(중복 제거) — 워밍업 일차 산출 */
export async function countDistinctPostingWarmupDays(
  accountId: string,
  now = new Date(),
): Promise<{ distinctDays: number; includesToday: boolean }> {
  const key = accountId.trim();
  if (!key) return { distinctDays: 0, includesToday: false };

  const { data: jobs, error } = await supabase
    .from('huma_jobs')
    .select('result_url, completed_at, scheduled_at, platform_schedule')
    .eq('account_id', key)
    .eq('job_type', 'post_blog')
    .eq('status', 'completed')
    .not('result_url', 'is', null);

  if (error) throw new Error(`포스팅 워밍업 일차 집계 실패: ${error.message}`);
  if (!jobs?.length) return { distinctDays: 0, includesToday: false };

  const postPublishedByUrl = await loadPostPublishedByUrl(
    key,
    jobs as PostBlogWarmupJob[],
  );

  const kstDates = new Set<string>();
  for (const job of jobs as PostBlogWarmupJob[]) {
    const kstDate = resolveWarmupPublishKstDateKey(job, postPublishedByUrl);
    if (kstDate) kstDates.add(kstDate);
  }

  const today = kstTodayKey(now);
  return {
    distinctDays: Math.min(MAX_WARMUP_DAY, kstDates.size),
    includesToday: kstDates.has(today),
  };
}

/** post_blog 발행 이력으로 warmup_day 보정 — UI·쿼터와 DB 불일치 해소 */
export async function reconcilePostingWarmupDay(
  accountId: string,
  now = new Date(),
): Promise<number> {
  const key = accountId.trim();
  if (!key) return 0;

  const { distinctDays, includesToday } = await countDistinctPostingWarmupDays(key, now);
  if (distinctDays <= 0) {
    const { data: acc } = await supabase
      .from('huma_accounts')
      .select('warmup_day')
      .eq('id', key)
      .maybeSingle();
    return (acc?.warmup_day as number | undefined) ?? 0;
  }

  const { data: account } = await supabase
    .from('huma_accounts')
    .select('warmup_day, warmup_last_increment_date')
    .eq('id', key)
    .maybeSingle();

  if (!account) return 0;

  const current = (account.warmup_day as number | undefined) ?? 0;
  const next = Math.min(MAX_WARMUP_DAY, Math.max(current, distinctDays));
  if (next === current) return current;

  const today = kstTodayKey(now);
  const patch: { warmup_day: number; warmup_last_increment_date?: string } = {
    warmup_day: next,
  };
  if (includesToday && account.warmup_last_increment_date !== today) {
    patch.warmup_last_increment_date = today;
  }

  await supabase.from('huma_accounts').update(patch).eq('id', key);
  return next;
}

/** 쿼터·스케줄용 — DB 0이면 post_blog 이력으로 1회 보정 */
export async function getPostingWarmupDay(accountId: string, now = new Date()): Promise<number> {
  const key = accountId.trim();
  if (!key) return 0;

  const { data } = await supabase
    .from('huma_accounts')
    .select('warmup_day')
    .eq('id', key)
    .maybeSingle();
  const stored = (data?.warmup_day as number | undefined) ?? 0;
  if (stored > 0) return stored;
  return reconcilePostingWarmupDay(key, now);
}

async function loadPostPublishedByUrl(
  accountId: string,
  jobs: PostBlogWarmupJob[],
): Promise<Map<string, string | null>> {
  const urlKeys = [
    ...new Set(
      jobs
        .map((j) => j.result_url)
        .filter((u): u is string => Boolean(u?.trim()))
        .map(normalizePostUrlKey),
    ),
  ];

  const postPublishedByUrl = new Map<string, string | null>();
  if (!urlKeys.length) return postPublishedByUrl;

  const { data: postRows } = await supabase
    .from('posts')
    .select('post_url, published_at')
    .eq('account_id', accountId);

  for (const row of postRows ?? []) {
    const k = normalizePostUrlKey(String(row.post_url ?? ''));
    if (k && urlKeys.includes(k) && row.published_at) {
      postPublishedByUrl.set(k, row.published_at as string);
    }
  }

  return postPublishedByUrl;
}
