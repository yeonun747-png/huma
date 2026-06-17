import type { Page } from 'playwright';
import { supabase } from '../../middleware/auth.js';
import { formatKstDateKey, getKstClock } from '../../lib/crank-schedule-config.js';
import { logOperation } from '../../lib/log-emitter.js';
import { sleep } from '../../lib/utils.js';
import { enqueueJob } from '../queue/producer.js';
import {
  extractBlogIdFromUrl,
  extractPostNoFromUrl,
  postRowMergeKey,
  resolveExtLinkCount,
} from './blog-url.js';
import { getCachedBlogPostList, loadBlogPostList, refreshBlogPostListCache } from './blog-post-list.js';
import { emptyPostContentStats, mergePostContentStats, parsePostContentStats, type PostContentStats } from './content-stats.js';
import { BLOG_CHECK_POST_LIMIT } from './constants.js';
import { computeBlogIndexScore, scrapeBlogStats } from './index-score.js';
import { scrapePostContentStats } from './post-content-scraper.js';
import type { PostExposureStatus } from './exposure-status.js';
import { notifyBlogCheckCaptcha, notifyBlogCheckIndexParseFailed } from './notify.js';
import {
  acquireBlogCheckScanLock,
  isBlogCheckScanLocked,
  releaseBlogCheckScanLock,
} from './scan-lock.js';
import { clearScanProgress, getScanProgress, setScanProgress, type BlogCheckScanProgress } from './scan-progress.js';
import {
  BlogCheckCaptchaError,
  checkPostExposure,
  detectBlogCheckCaptcha,
  randomScanDelayMs,
  resolveBlogId,
  withBlogCheckBrowser,
} from './scanner.js';

const WS_LABEL: Record<string, string> = {
  yeonun: '연운',
  quizoasis: '퀴즈',
  panana: '파나나',
};

const WORKSPACE_SORT: Record<string, number> = {
  yeonun: 0,
  panana: 1,
  quizoasis: 2,
};

const POST_LIMIT = BLOG_CHECK_POST_LIMIT;
const JOB_FETCH_LIMIT = 200;

export type TrendDirection = '안정' | '악화' | '개선' | '데이터 부족';

interface AccountRow {
  id: string;
  name: string;
  naver_id: string;
  blog_url: string | null;
  workspace: string;
  slot_label: string | null;
  proxy_port: number | null;
  session_status: string | null;
  is_active?: boolean;
}

interface PostRow extends PostContentStats {
  id: string;
  account_id: string;
  post_url: string;
  post_no: string | null;
  title: string | null;
  published_at: string;
  ext_link_cleared: boolean;
}

interface StatusRow {
  post_no: string;
  status: PostExposureStatus;
  rank: number | null;
  scanned_at: string;
  chars?: number | null;
  img_count?: number | null;
  video_count?: number | null;
  quote_count?: number | null;
  comment_count?: number | null;
  like_count?: number | null;
  gif_count?: number | null;
  map_count?: number | null;
  hidden_count?: number | null;
  int_link_count?: number | null;
  ext_link_count?: number | null;
}

function statsFromDbRow(row: Record<string, unknown>, workspace?: string | null): PostContentStats {
  const base = emptyPostContentStats();
  const merged: PostContentStats = {
    char_count: Number(row.char_count ?? 0),
    img_count: Number(row.img_count ?? 0),
    video_count: Number(row.video_count ?? 0),
    quote_count: Number(row.quote_count ?? 0),
    comment_count: Number(row.comment_count ?? 0),
    like_count: Number(row.like_count ?? 0),
    gif_count: Number(row.gif_count ?? 0),
    map_count: Number(row.map_count ?? 0),
    hidden_count: Number(row.hidden_count ?? 0),
    int_link_count: Number(row.int_link_count ?? 0),
    ext_link_count: Number(row.ext_link_count ?? 0),
  };
  if (row.ext_link_cleared) merged.ext_link_count = 0;
  else {
    merged.ext_link_count = Math.max(
      merged.ext_link_count,
      resolveExtLinkCount(null, null, workspace),
    );
  }
  return mergePostContentStats(base, merged);
}

function statsFromStatusRow(row: StatusRow, extLinkCleared?: boolean): PostContentStats {
  return {
    char_count: Number(row.chars ?? 0),
    img_count: Number(row.img_count ?? 0),
    video_count: Number(row.video_count ?? 0),
    quote_count: Number(row.quote_count ?? 0),
    comment_count: Number(row.comment_count ?? 0),
    like_count: Number(row.like_count ?? 0),
    gif_count: Number(row.gif_count ?? 0),
    map_count: Number(row.map_count ?? 0),
    hidden_count: Number(row.hidden_count ?? 0),
    int_link_count: Number(row.int_link_count ?? 0),
    ext_link_count: extLinkCleared ? 0 : Number(row.ext_link_count ?? 0),
  };
}

function statusInsertPayload(
  stats: PostContentStats,
  rankResult: { status: PostExposureStatus; rank: number | null },
  extLinkCleared?: boolean,
) {
  return {
    chars: stats.char_count,
    img_count: stats.img_count,
    video_count: stats.video_count,
    quote_count: stats.quote_count,
    comment_count: stats.comment_count,
    like_count: stats.like_count,
    gif_count: stats.gif_count,
    map_count: stats.map_count,
    hidden_count: stats.hidden_count,
    int_link_count: stats.int_link_count,
    ext_link_count: extLinkCleared ? 0 : stats.ext_link_count,
    status: rankResult.status,
    rank: rankResult.rank,
  };
}

async function persistCrawledPostStats(
  accountId: string,
  post: PostRow,
  stats: PostContentStats,
): Promise<void> {
  const { error } = await supabase.from('posts').upsert(
    {
      account_id: accountId,
      post_url: post.post_url,
      post_no: post.post_no,
      title: post.title,
      published_at: post.published_at,
      char_count: stats.char_count,
      img_count: stats.img_count,
      video_count: stats.video_count,
      quote_count: stats.quote_count,
      comment_count: stats.comment_count,
      like_count: stats.like_count,
      gif_count: stats.gif_count,
      map_count: stats.map_count,
      hidden_count: stats.hidden_count,
      int_link_count: stats.int_link_count,
      ext_link_count: post.ext_link_cleared ? 0 : stats.ext_link_count,
      ext_link_cleared: post.ext_link_cleared,
    },
    { onConflict: 'account_id,post_url' },
  );
  if (error) {
    console.error('[blog-check] posts upsert failed:', error.message);
  }
}

function sortAccounts(accounts: AccountRow[]): AccountRow[] {
  return [...accounts].sort((a, b) => {
    const ws = (WORKSPACE_SORT[a.workspace] ?? 9) - (WORKSPACE_SORT[b.workspace] ?? 9);
    if (ws !== 0) return ws;
    return (a.proxy_port ?? 999) - (b.proxy_port ?? 999);
  });
}

function todayKstDate(): string {
  return formatKstDateKey();
}

function mapSessionStatus(raw: string | null | undefined, isActive?: boolean): '정상' | '오류' {
  if (raw != null && raw !== '') return raw === 'active' ? '정상' : '오류';
  return isActive !== false ? '정상' : '오류';
}

export function trendDirection(trend: (number | null)[]): TrendDirection {
  const scanned = trend.filter((v): v is number => v !== null);
  if (scanned.length < 2) return '데이터 부족';
  const first = scanned[0] ?? 0;
  const last = scanned[scanned.length - 1] ?? 0;
  if (last > first) return '악화';
  if (last < first) return '개선';
  return '안정';
}

async function listActivePostingAccounts(accountId?: string): Promise<AccountRow[]> {
  const withSessionStatus = 'id, name, naver_id, blog_url, workspace, slot_label, proxy_port, session_status';
  const withoutSessionStatus =
    'id, name, naver_id, blog_url, workspace, slot_label, proxy_port, is_active';

  const buildQuery = (fields: string) => {
    let q = supabase
      .from('huma_accounts')
      .select(fields)
      .eq('account_type', 'posting')
      .eq('is_active', true);
    if (accountId) q = q.eq('id', accountId);
    return q;
  };

  const { data, error } = await buildQuery(withSessionStatus);

  if (error?.message?.includes('session_status')) {
    const { data: fallback, error: err2 } = await buildQuery(withoutSessionStatus);
    if (err2) throw new Error(err2.message);
    return sortAccounts(
      (fallback ?? []).map((row) => {
        const acc = row as AccountRow & { is_active?: boolean };
        return {
          ...acc,
          session_status: acc.is_active !== false ? 'active' : 'error',
        };
      }),
    );
  }

  if (error) throw new Error(error.message);
  return sortAccounts((data ?? []) as AccountRow[]);
}

interface JobPostSource {
  result_url: string | null;
  title: string | null;
  content: string | null;
  link_url: string | null;
  image_urls: string[] | null;
  content_type?: string | null;
  completed_at: string | null;
  scheduled_at: string | null;
  created_at: string;
}

/** posts.ext_link_count 보정 — huma_jobs·워크스페이스 기준 */
async function reconcileExtLinkCountsFromJobs(
  accountId: string,
  posts: Map<string, PostRow>,
  jobs: JobPostSource[] | null,
  workspace?: string | null,
): Promise<void> {
  if (!jobs?.length) return;

  const jobByKey = new Map<string, JobPostSource>();
  for (const job of jobs) {
    const url = String(job.result_url ?? '').trim();
    if (!url) continue;
    jobByKey.set(postRowMergeKey(url, extractPostNoFromUrl(url)), job);
  }

  for (const row of posts.values()) {
    if (row.ext_link_cleared) continue;
    const job =
      jobByKey.get(postRowMergeKey(row.post_url, row.post_no)) ??
      jobByKey.get(postRowMergeKey(row.post_url, extractPostNoFromUrl(row.post_url)));

    const fromJob = job
      ? resolveExtLinkCount(job.content, job.link_url, workspace)
      : resolveExtLinkCount(null, null, workspace);

    const next = Math.max(row.ext_link_count, fromJob);
    if (next <= row.ext_link_count) continue;

    row.ext_link_count = next;
    let q = supabase
      .from('posts')
      .update({ ext_link_count: next })
      .eq('account_id', accountId)
      .eq('ext_link_cleared', false);
    if (row.post_no) q = q.eq('post_no', row.post_no);
    else q = q.eq('post_url', row.post_url);
    const { error } = await q;
    if (error) {
      console.error('[blog-check] ext_link_count reconcile failed:', error.message);
    }
  }
}

function jobToPostRow(accountId: string, job: JobPostSource, workspace?: string | null): PostRow {
  const postUrl = String(job.result_url ?? '').trim();
  const postNo = extractPostNoFromUrl(postUrl);
  const stats = parsePostContentStats(job.content, {
    linkUrl: job.link_url,
    workspace,
    imageUrls: job.image_urls,
    hasVideo: job.content_type === 'B',
  });
  return {
    id: postUrl,
    account_id: accountId,
    post_url: postUrl,
    post_no: postNo,
    title: job.title ?? null,
    published_at:
      job.completed_at ?? job.scheduled_at ?? job.created_at ?? new Date().toISOString(),
    ext_link_cleared: false,
    ...stats,
  };
}

function mergePublishedAt(a: string, b: string): string {
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (!Number.isFinite(ta)) return b;
  if (!Number.isFinite(tb)) return a;

  const hasExplicitTime = (iso: string) =>
    /T\d{2}:\d{2}:\d{2}/.test(iso) && !/T00:00:00/.test(iso);

  const aHas = hasExplicitTime(a);
  const bHas = hasExplicitTime(b);
  if (aHas && !bHas) return a;
  if (bHas && !aHas) return b;
  return tb > ta ? b : a;
}

/** published_at 내림차순 최근 15건 — 블로그 공개 목록 + huma_jobs/posts 병합 */
async function fetchRecentPosts(
  accountId: string,
  opts?: { page?: Page; blogId?: string | null; refreshIfMissing?: boolean },
): Promise<PostRow[]> {
  const { data: acc } = await supabase
    .from('huma_accounts')
    .select('workspace, blog_url, naver_id')
    .eq('id', accountId)
    .maybeSingle();
  const workspace = (acc?.workspace as string | undefined) ?? null;
  const blogId = opts?.blogId ?? extractBlogIdFromUrl(acc?.blog_url, acc?.naver_id);

  let blogPosts: Awaited<ReturnType<typeof loadBlogPostList>> = [];
  if (blogId) {
    try {
      if (opts?.page) {
        blogPosts = await loadBlogPostList(accountId, blogId, opts.page);
      } else if (opts?.refreshIfMissing) {
        blogPosts = await loadBlogPostList(accountId, blogId);
      } else {
        blogPosts = (await getCachedBlogPostList(accountId)) ?? [];
      }
    } catch (err) {
      console.error('[blog-check] blog post list load failed:', err);
    }
  }

  const [{ data: fromPosts, error }, { data: jobs, error: jobErr }] = await Promise.all([
    supabase.from('posts').select('*').eq('account_id', accountId).order('published_at', { ascending: false }).limit(JOB_FETCH_LIMIT),
    supabase
      .from('huma_jobs')
      .select('result_url, title, content, link_url, image_urls, content_type, completed_at, scheduled_at, created_at')
      .eq('account_id', accountId)
      .eq('job_type', 'post_blog')
      .eq('status', 'completed')
      .not('result_url', 'is', null)
      .order('completed_at', { ascending: false })
      .limit(JOB_FETCH_LIMIT),
  ]);

  if (error) throw new Error(error.message);
  if (jobErr) throw new Error(jobErr.message);

  const merged = new Map<string, PostRow>();

  for (const bp of blogPosts) {
    const stats = parsePostContentStats(null, { workspace });
    merged.set(`no:${bp.postNo}`, {
      id: bp.postUrl,
      account_id: accountId,
      post_url: bp.postUrl,
      post_no: bp.postNo,
      title: bp.title,
      published_at: bp.publishedAt ?? new Date(0).toISOString(),
      ext_link_cleared: false,
      ...stats,
    });
  }

  for (const job of jobs ?? []) {
    const postUrl = String(job.result_url ?? '').trim();
    if (!postUrl) continue;
    const key = postRowMergeKey(postUrl, extractPostNoFromUrl(postUrl));
    merged.set(key, jobToPostRow(accountId, job as JobPostSource, workspace));
  }

  for (const row of (fromPosts ?? []) as PostRow[]) {
    const key = postRowMergeKey(row.post_url, row.post_no);
    const existing = merged.get(key);
    if (existing) {
      merged.set(key, {
        ...existing,
        ...row,
        published_at: mergePublishedAt(existing.published_at, row.published_at),
        ...mergePostContentStats(existing, statsFromDbRow(row as unknown as Record<string, unknown>, workspace)),
        ext_link_cleared: row.ext_link_cleared,
      });
    } else {
      merged.set(key, {
        ...(row as PostRow),
        ...statsFromDbRow(row as unknown as Record<string, unknown>, workspace),
      });
    }
  }

  await reconcileExtLinkCountsFromJobs(accountId, merged, (jobs ?? []) as JobPostSource[], workspace);

  return Array.from(merged.values())
    .sort((a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime())
    .slice(0, POST_LIMIT);
}

async function fetchLatestStatusByPostNo(accountId: string): Promise<Map<string, StatusRow>> {
  const { data, error } = await supabase
    .from('blog_post_status')
    .select(
      'post_no, status, rank, scanned_at, chars, img_count, video_count, quote_count, comment_count, like_count, gif_count, map_count, hidden_count, int_link_count, ext_link_count',
    )
    .eq('account_id', accountId)
    .order('scanned_at', { ascending: false });

  if (error) throw new Error(error.message);

  const map = new Map<string, StatusRow>();
  for (const row of data ?? []) {
    const postNo = String(row.post_no);
    if (!map.has(postNo)) {
      const raw = String(row.status);
      const status: PostExposureStatus =
        raw === 'ok' ? 'good' : (raw as PostExposureStatus);
      map.set(postNo, { ...(row as StatusRow), status });
    }
  }
  return map;
}

/** 7일 추이 — 스캔 안 한 날은 null */
async function buildSevenDayMissTrend(accountId: string): Promise<(number | null)[]> {
  const dayKeys: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    dayKeys.push(formatKstDateKey(d));
  }

  const { data, error } = await supabase
    .from('blog_post_status')
    .select('scanned_at, status')
    .eq('account_id', accountId)
    .gte('scanned_at', dayKeys[0]);

  if (error) return dayKeys.map(() => null);

  const scannedDays = new Set<string>();
  const missByDay = new Map<string, number>();

  for (const row of data ?? []) {
    const day = String(row.scanned_at).slice(0, 10);
    scannedDays.add(day);
    if (row.status === 'miss') {
      missByDay.set(day, (missByDay.get(day) ?? 0) + 1);
    }
  }

  return dayKeys.map((day) => {
    if (!scannedDays.has(day)) return null;
    return missByDay.get(day) ?? 0;
  });
}

interface ScanWorkItem {
  acc: AccountRow;
  blogId: string;
  label: string;
  posts: PostRow[];
}

async function reportScanProgress(params: {
  accountId?: string | null;
  accountLabel?: string | null;
  completed: number;
  total: number;
  phase: BlogCheckScanProgress['phase'];
}): Promise<void> {
  const total = Math.max(params.total, 1);
  const percent = Math.min(100, Math.round((params.completed / total) * 100));
  await setScanProgress({
    accountId: params.accountId ?? null,
    accountLabel: params.accountLabel ?? null,
    completed: params.completed,
    total: params.total,
    percent,
    phase: params.phase,
  });
}

export async function runBlogCheckScan(accountId?: string): Promise<{
  scannedAccounts: number;
  scannedPosts: number;
}> {
  const scanDate = todayKstDate();
  let scannedAccounts = 0;
  let scannedPosts = 0;

  const accounts = await listActivePostingAccounts(accountId);
  if (!accounts.length) return { scannedAccounts: 0, scannedPosts: 0 };

  await reportScanProgress({
    accountId: accountId ?? null,
    completed: 0,
    total: 1,
    phase: 'preparing',
  });

  let totalSteps = 0;

  await withBlogCheckBrowser(async (page) => {
    const workItems: ScanWorkItem[] = [];

    for (const acc of accounts) {
      const blogId = resolveBlogId(acc.blog_url, acc.naver_id);
      if (!blogId) {
        await logOperation({
          level: 'warn',
          message: `[blog-check] blogId 없음 — ${acc.name}`,
          account_id: acc.id,
        });
        continue;
      }

      const label = acc.name || acc.slot_label || acc.naver_id;
      await reportScanProgress({
        accountId: acc.id,
        accountLabel: label,
        completed: workItems.length,
        total: Math.max(workItems.length + 1, 1),
        phase: 'preparing',
      });

      await refreshBlogPostListCache(acc.id, blogId, page);
      const posts = await fetchRecentPosts(acc.id, { page, blogId });
      workItems.push({ acc, blogId, label, posts });
    }

    totalSteps =
      workItems.reduce(
        (sum, item) =>
          sum +
          item.posts.filter((p) => p.post_no ?? extractPostNoFromUrl(p.post_url)).length,
        0,
      ) + workItems.length;

    let completedSteps = 0;
    await reportScanProgress({
      accountId: accountId ?? workItems[0]?.acc.id ?? null,
      accountLabel: workItems[0]?.label ?? null,
      completed: 0,
      total: totalSteps,
      phase: 'scanning',
    });

    for (const item of workItems) {
      const { acc, blogId, label, posts } = item;
      let accountAborted = false;

      const parsed = await scrapeBlogStats(page, blogId);
      if (parsed) {
        const idxScore = computeBlogIndexScore(parsed.stats);
        const { error: idxErr } = await supabase.from('blog_index_history').insert({
          account_id: acc.id,
          scanned_at: scanDate,
          idx_score: idxScore,
          visitor_count: parsed.stats.visitorCount,
          buddy_count: parsed.stats.buddyCount,
          post_count: parsed.stats.postCount,
        });
        if (idxErr) {
          await logOperation({
            level: 'warn',
            message: `[blog-check] blog_index_history insert: ${idxErr.message}`,
            account_id: acc.id,
          });
        }
      } else {
        await supabase.from('blog_index_history').insert({
          account_id: acc.id,
          scanned_at: scanDate,
          idx_score: null,
          visitor_count: 0,
          buddy_count: 0,
          post_count: 0,
        });
        await notifyBlogCheckIndexParseFailed(blogId, acc.workspace);
        await logOperation({
          level: 'warn',
          message: `[blog-check] 지수 파싱 실패 (${blogId}) — idx_score=null`,
          account_id: acc.id,
        });
      }

      if (await detectBlogCheckCaptcha(page)) {
        await notifyBlogCheckCaptcha(blogId, label, acc.workspace);
        accountAborted = true;
      }

      completedSteps += 1;
      await reportScanProgress({
        accountId: acc.id,
        accountLabel: label,
        completed: completedSteps,
        total: totalSteps,
        phase: 'scanning',
      });

      for (let i = 0; i < posts.length && !accountAborted; i++) {
        const post = posts[i];
        const postNo = post.post_no ?? extractPostNoFromUrl(post.post_url);
        if (!postNo) continue;

        const title = post.title?.trim() || '—';

        try {
          const contentStats = await scrapePostContentStats(page, blogId, postNo);
          const rankResult = await checkPostExposure(page, blogId, postNo, title);

          const { error: insErr } = await supabase.from('blog_post_status').insert({
            account_id: acc.id,
            post_url: post.post_url,
            post_no: postNo,
            title: post.title,
            scanned_at: scanDate,
            ...statusInsertPayload(contentStats, rankResult, post.ext_link_cleared),
          });

          if (insErr) throw new Error(`blog_post_status insert 실패: ${insErr.message}`);
          await persistCrawledPostStats(acc.id, post, contentStats);
          scannedPosts += 1;
        } catch (err) {
          if (err instanceof BlogCheckCaptchaError) {
            await notifyBlogCheckCaptcha(blogId, label, acc.workspace);
            await logOperation({
              level: 'warn',
              message: `[blog-check] 캡차 감지 — ${label} 스캔 중단`,
              account_id: acc.id,
            });
            break;
          }
          throw err;
        }

        completedSteps += 1;
        await reportScanProgress({
          accountId: acc.id,
          accountLabel: label,
          completed: completedSteps,
          total: totalSteps,
          phase: 'scanning',
        });

        if (i < posts.length - 1) await sleep(randomScanDelayMs());
      }

      scannedAccounts += 1;
      await logOperation({
        level: 'info',
        message: `[blog-check] ${label} — 포스트 ${posts.length}건 · 지수 ${parsed ? computeBlogIndexScore(parsed.stats) : 'null'}`,
        account_id: acc.id,
      });
    }
  });

  if (totalSteps > 0) {
    await reportScanProgress({
      accountId: accountId ?? null,
      completed: totalSteps,
      total: totalSteps,
      phase: 'done',
    });
  }

  return { scannedAccounts, scannedPosts };
}

export async function requestBlogCheckScan(accountId?: string): Promise<{ queued: true; accountId?: string }> {
  if (!(await acquireBlogCheckScanLock())) {
    throw new Error('SCAN_ALREADY_RUNNING');
  }

  try {
    await enqueueJob({
      type: 'blog_check',
      payload: { accountId: accountId ?? null },
    });
    return { queued: true, accountId };
  } catch (err) {
    await releaseBlogCheckScanLock();
    throw err;
  }
}

export async function executeBlogCheckJob(payload: { accountId?: string | null }) {
  try {
    return await runBlogCheckScan(payload.accountId ?? undefined);
  } finally {
    await releaseBlogCheckScanLock();
    await clearScanProgress();
  }
}

export async function getBlogCheckScanState() {
  const scanning = await isBlogCheckScanLocked();
  return {
    scanning,
    lastScanAt: null as string | null,
    scanProgress: scanning ? await getScanProgress() : null,
  };
}

export async function buildBlogCheckAccountsResponse(allowedWorkspaces: string[]) {
  const accounts = sortAccounts(
    (await listActivePostingAccounts()).filter((a) => allowedWorkspaces.includes(a.workspace)),
  );

  const result = [];
  for (const acc of accounts) {
    const blogId = extractBlogIdFromUrl(acc.blog_url, acc.naver_id) ?? acc.naver_id;
    const recentPosts = await fetchRecentPosts(acc.id, { blogId });
    const statusMap = await fetchLatestStatusByPostNo(acc.id);

    let strongCount = 0;
    let goodCount = 0;
    let weakCount = 0;
    let collectCount = 0;
    let missCount = 0;
    for (const post of recentPosts) {
      const postNo = post.post_no ?? extractPostNoFromUrl(post.post_url);
      if (!postNo) continue;
      const st = statusMap.get(postNo);
      if (!st) continue;
      if (st.status === 'strong') strongCount += 1;
      else if (st.status === 'good') goodCount += 1;
      else if (st.status === 'weak') weakCount += 1;
      else if (st.status === 'collect') collectCount += 1;
      else missCount += 1;
    }

    const totalPosts = recentPosts.length;
    const missRate = totalPosts > 0 ? Math.round((missCount / totalPosts) * 100) : 0;
    const trend = await buildSevenDayMissTrend(acc.id);

    const { data: idxRow } = await supabase
      .from('blog_index_history')
      .select('idx_score')
      .eq('account_id', acc.id)
      .order('scanned_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    result.push({
      account_id: acc.id,
      label: acc.name || acc.slot_label || acc.naver_id,
      svc: WS_LABEL[acc.workspace] ?? acc.workspace,
      blog_url: blogId,
      idx_score: idxRow?.idx_score != null ? Number(idxRow.idx_score) : null,
      total_posts: totalPosts,
      strong_count: strongCount,
      good_count: goodCount,
      weak_count: weakCount,
      collect_count: collectCount,
      miss_count: missCount,
      miss_rate: missRate,
      trend,
      trend_direction: trendDirection(trend),
      session_status: mapSessionStatus(acc.session_status, acc.is_active),
    });
  }

  const lastScanAt =
    (
      await supabase
        .from('blog_index_history')
        .select('created_at')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
    ).data?.created_at ?? null;

  const scanning = await isBlogCheckScanLocked();

  return {
    accounts: result,
    lastScanAt,
    scanning,
    scanProgress: scanning ? await getScanProgress() : null,
  };
}

export async function buildBlogCheckPostsResponse(accountId: string) {
  const { data: acc } = await supabase
    .from('huma_accounts')
    .select('workspace, blog_url, naver_id')
    .eq('id', accountId)
    .maybeSingle();
  const workspace = (acc?.workspace as string | undefined) ?? null;
  const blogId = extractBlogIdFromUrl(acc?.blog_url, acc?.naver_id);

  const posts = await fetchRecentPosts(accountId, { blogId, refreshIfMissing: true });
  const statusMap = await fetchLatestStatusByPostNo(accountId);

  return {
    posts: posts.map((post) => {
      const postNo = post.post_no ?? extractPostNoFromUrl(post.post_url) ?? '';
      const st = postNo ? statusMap.get(postNo) : undefined;
      const stats = st
        ? statsFromStatusRow(st, post.ext_link_cleared)
        : statsFromDbRow(post as unknown as Record<string, unknown>, workspace);

      return {
        post_url: post.post_url,
        post_no: postNo || null,
        title: post.title ?? '—',
        published_at: post.published_at,
        status: st?.status ?? null,
        rank: st?.rank ?? null,
        chars: stats.char_count,
        img_count: stats.img_count,
        video_count: stats.video_count,
        quote_count: stats.quote_count,
        comment_count: stats.comment_count,
        like_count: stats.like_count,
        gif_count: stats.gif_count,
        map_count: stats.map_count,
        hidden_count: stats.hidden_count,
        int_link_count: stats.int_link_count,
        ext_link_count: stats.ext_link_count,
      };
    }),
  };
}

let lastScheduledKey = '';

/** 매일 09:00 KST — blog-check-daily */
export function startBlogCheckScheduler(): void {
  const tick = () => {
    const { hour, minute } = getKstClock();
    if (hour !== 9 || minute !== 0) return;
    const key = formatKstDateKey();
    if (lastScheduledKey === key) return;
    lastScheduledKey = key;
    requestBlogCheckScan().catch((err) => console.error('[blog-check-scheduler]', err));
  };

  setInterval(tick, 30_000);
  tick();
}
