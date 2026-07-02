import { supabase } from '../middleware/auth.js';
import { normalizePostUrlKey } from '../modules/blog-check/blog-url.js';
import { isAutoPublishJob } from './auto-publish-state.js';
import { resolveJobPublishedAtIso } from './post-blog-publish-day.js';
import { formatKstDateKey } from './posting-daily-target.js';

const MAX_WARMUP_DAY = 30;

function kstTodayKey(now = new Date()): string {
  return formatKstDateKey(now);
}

function isAutoPublishWarmupJob(platformSchedule: unknown): boolean {
  return isAutoPublishJob(platformSchedule);
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

  const { error } = await supabase
    .from('huma_accounts')
    .update({
      warmup_day: (account.warmup_day ?? 0) + 1,
      warmup_last_increment_date: today,
    })
    .eq('id', accountId);

  if (error) console.error('[warmup] maybeIncrementWarmupDay failed:', error.message);
}

type PostBlogWarmupJob = {
  result_url: string | null;
  completed_at: string | null;
  scheduled_at?: string | null;
  platform_schedule: unknown;
};

function resolveWarmupJobInstantIso(
  job: PostBlogWarmupJob,
  postPublishedByUrl?: Map<string, string | null>,
): string | null {
  const publishedAt = resolveJobPublishedAtIso(job, postPublishedByUrl);
  if (publishedAt?.trim()) return publishedAt;
  const scheduled = job.scheduled_at?.trim();
  if (scheduled) return scheduled;
  const completed = job.completed_at?.trim();
  if (completed) return completed;
  return null;
}

function isWarmupJobAfterEpoch(
  job: PostBlogWarmupJob,
  epochIso: string | null | undefined,
  postPublishedByUrl?: Map<string, string | null>,
): boolean {
  if (!epochIso?.trim()) return true;
  const epochMs = Date.parse(epochIso);
  if (!Number.isFinite(epochMs)) return true;
  const instant = resolveWarmupJobInstantIso(job, postPublishedByUrl);
  if (!instant) return false;
  const ms = Date.parse(instant);
  return Number.isFinite(ms) && ms >= epochMs;
}

/** reconcile 시 epoch 이후면 distinctDays만 반영(감소 허용), 없으면 기존처럼 상향만 */
export function resolveReconcileWarmupDay(
  current: number,
  distinctDays: number,
  epochAt: string | null | undefined,
): number {
  if (distinctDays <= 0) return current;
  const next = epochAt?.trim() ? distinctDays : Math.max(current, distinctDays);
  return Math.min(MAX_WARMUP_DAY, next);
}

/** 네이버 ID 교체 — 워밍업 단계·일차·평일상한 UI를 처음부터 */
export function postingWarmupResetPatch(now = new Date()): {
  warmup_day: number;
  warmup_last_increment_date: null;
  posting_warmup_started_kst: null;
  posting_warmup_epoch_at: string;
} {
  return {
    warmup_day: 0,
    warmup_last_increment_date: null,
    posting_warmup_started_kst: null,
    posting_warmup_epoch_at: now.toISOString(),
  };
}

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

/** 자동발행 워밍업 기준일 — 없으면 첫 content_full(_auto_publish) 또는 post_blog 최초일 */
export async function ensurePostingWarmupStartedKst(accountId: string): Promise<string | null> {
  const key = accountId.trim();
  if (!key) return null;

  const { data: acc, error: accErr } = await supabase
    .from('huma_accounts')
    .select('posting_warmup_started_kst, auto_publish_enabled, posting_warmup_epoch_at')
    .eq('id', key)
    .maybeSingle();

  if (accErr) throw new Error(`워밍업 기준일 조회 실패: ${accErr.message}`);
  const stored = (acc?.posting_warmup_started_kst as string | null)?.trim();
  const epochAt = (acc?.posting_warmup_epoch_at as string | null)?.trim() ?? null;
  if (stored) return stored;

  const { data: firstAutoContent } = await supabase
    .from('huma_jobs')
    .select('created_at')
    .eq('account_id', key)
    .eq('job_type', 'content_full')
    .contains('platform_schedule', { _auto_publish: true })
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  let started: string | null = null;
  if (firstAutoContent?.created_at) {
    const createdIso = firstAutoContent.created_at as string;
    if (!epochAt?.trim() || isWarmupJobAfterEpoch({ result_url: 'x', completed_at: createdIso, platform_schedule: {} }, epochAt)) {
      started = formatKstDateKey(new Date(createdIso));
    }
  }
  if (!started) {
    const { data: jobs } = await supabase
      .from('huma_jobs')
      .select('completed_at, scheduled_at, platform_schedule, result_url')
      .eq('account_id', key)
      .eq('job_type', 'post_blog')
      .eq('status', 'completed')
      .not('result_url', 'is', null)
      .order('completed_at', { ascending: true })
      .limit(50);

    for (const job of jobs ?? []) {
      if (acc?.auto_publish_enabled && !isAutoPublishWarmupJob(job.platform_schedule)) continue;
      if (!isWarmupJobAfterEpoch(job as PostBlogWarmupJob, epochAt)) continue;
      const kst = resolveWarmupPublishKstDateKey(job as PostBlogWarmupJob);
      if (kst) {
        started = kst;
        break;
      }
    }
  }

  if (!started) return null;

  const { error: updErr } = await supabase
    .from('huma_accounts')
    .update({ posting_warmup_started_kst: started })
    .eq('id', key);

  if (updErr) throw new Error(`워밍업 기준일 저장 실패: ${updErr.message}`);
  return started;
}

/** 완료 post_blog 발행일(KST) 중복 제거 — 기준일 이후·자동발행 job만(가능 시) */
export async function countDistinctPostingWarmupDays(
  accountId: string,
  now = new Date(),
): Promise<{ distinctDays: number; includesToday: boolean; startedKst: string | null }> {
  const key = accountId.trim();
  if (!key) return { distinctDays: 0, includesToday: false, startedKst: null };

  const { data: accMeta } = await supabase
    .from('huma_accounts')
    .select('auto_publish_enabled, posting_warmup_started_kst, posting_warmup_epoch_at')
    .eq('id', key)
    .maybeSingle();

  const startedKst =
    (accMeta?.posting_warmup_started_kst as string | null)?.trim() ??
    (await ensurePostingWarmupStartedKst(key));
  const epochAt = (accMeta?.posting_warmup_epoch_at as string | null)?.trim() ?? null;

  const kstDates = new Set<string>();

  const { data: jobs, error } = await supabase
    .from('huma_jobs')
    .select('result_url, completed_at, scheduled_at, platform_schedule')
    .eq('account_id', key)
    .eq('job_type', 'post_blog')
    .eq('status', 'completed')
    .not('result_url', 'is', null);

  if (error) throw new Error(`포스팅 워밍업 일차 집계 실패: ${error.message}`);

  if (jobs?.length) {
    const autoOnly = Boolean(accMeta?.auto_publish_enabled);
    const flagged = (jobs as PostBlogWarmupJob[]).filter((job) =>
      isAutoPublishWarmupJob(job.platform_schedule),
    );
    const jobsToCount =
      autoOnly && flagged.length ? flagged : (jobs as PostBlogWarmupJob[]);

    const postPublishedByUrl = await loadPostPublishedByUrl(key, jobsToCount);
    for (const job of jobsToCount) {
      if (!isWarmupJobAfterEpoch(job, epochAt, postPublishedByUrl)) continue;
      const kstDate = resolveWarmupPublishKstDateKey(job, postPublishedByUrl);
      if (!kstDate) continue;
      if (startedKst && kstDate < startedKst) continue;
      kstDates.add(kstDate);
    }
  }

  const today = kstTodayKey(now);
  return {
    distinctDays: Math.min(MAX_WARMUP_DAY, kstDates.size),
    includesToday: kstDates.has(today),
    startedKst: startedKst ?? null,
  };
}

/** post_blog 발행 이력으로 warmup_day 보정 — UI·쿼터와 DB 불일치 해소 */
export async function reconcilePostingWarmupDay(
  accountId: string,
  now = new Date(),
): Promise<number> {
  const key = accountId.trim();
  if (!key) return 0;

  const { data: accountMeta } = await supabase
    .from('huma_accounts')
    .select('warmup_day, warmup_last_increment_date, posting_warmup_epoch_at')
    .eq('id', key)
    .maybeSingle();

  if (!accountMeta) return 0;

  const epochAt = (accountMeta.posting_warmup_epoch_at as string | null)?.trim() ?? null;
  const current = (accountMeta.warmup_day as number | undefined) ?? 0;

  await ensurePostingWarmupStartedKst(key).catch((err) => {
    console.error('[warmup] ensurePostingWarmupStartedKst:', (err as Error).message);
  });

  const { distinctDays, includesToday } = await countDistinctPostingWarmupDays(key, now);
  if (distinctDays <= 0) {
    if (epochAt && current > 0) {
      const { error: updErr } = await supabase
        .from('huma_accounts')
        .update({ warmup_day: 0, warmup_last_increment_date: null })
        .eq('id', key);
      if (updErr) throw new Error(`warmup_day 초기화 저장 실패: ${updErr.message}`);
      return 0;
    }
    return current;
  }

  const next = resolveReconcileWarmupDay(current, distinctDays, epochAt);
  if (next === current) return current;

  const today = kstTodayKey(now);
  const patch: { warmup_day: number; warmup_last_increment_date?: string | null } = {
    warmup_day: next,
  };
  if (includesToday && accountMeta.warmup_last_increment_date !== today) {
    patch.warmup_last_increment_date = today;
  } else if (epochAt && next < current) {
    patch.warmup_last_increment_date = null;
  }

  const { error: updErr } = await supabase.from('huma_accounts').update(patch).eq('id', key);
  if (updErr) throw new Error(`warmup_day 보정 저장 실패: ${updErr.message}`);
  return next;
}

/** 활성 포스팅 계정 전체 warmup_day 보정 — 서버 기동·자정 롤오버 후 */
export async function reconcileAllPostingWarmupDays(): Promise<void> {
  const { data: rows, error } = await supabase
    .from('huma_accounts')
    .select('id')
    .eq('account_type', 'posting')
    .eq('is_active', true);

  if (error) {
    console.error('[warmup] reconcileAll list failed:', error.message);
    return;
  }

  for (const row of rows ?? []) {
    try {
      await reconcilePostingWarmupDay(row.id as string);
    } catch (err) {
      console.error('[warmup] reconcile failed', row.id, (err as Error).message);
    }
  }
}

/** 쿼터·스케줄용 — DB 0이면 post_blog 이력으로 1회 보정 */
export async function getPostingWarmupDay(accountId: string, now = new Date()): Promise<number> {
  const key = accountId.trim();
  if (!key) return 0;

  const { data } = await supabase
    .from('huma_accounts')
    .select('warmup_day, posting_warmup_epoch_at')
    .eq('id', key)
    .maybeSingle();
  const stored = (data?.warmup_day as number | undefined) ?? 0;
  const hasEpoch = Boolean((data?.posting_warmup_epoch_at as string | null)?.trim());
  if (stored > 0 && !hasEpoch) return stored;
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
