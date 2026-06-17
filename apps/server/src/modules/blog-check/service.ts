import type { Page } from 'playwright';
import { supabase } from '../../middleware/auth.js';
import { formatKstDateKey, getKstClock } from '../../lib/crank-schedule-config.js';
import { logOperation } from '../../lib/log-emitter.js';
import { sleep } from '../../lib/utils.js';
import { enqueueJob } from '../queue/producer.js';
import {
  type AdHocBlogCheckPost,
  getAdHocBlogCheckCache,
  setAdHocBlogCheckCache,
} from './adhoc-scan.js';
import {
  extractBlogIdFromUrl,
  extractPostNoFromUrl,
  parseBlogCheckSearchQuery,
  postRowMergeKey,
  resolveExtLinkCount,
} from './blog-url.js';
import {
  getCachedBlogPostList,
  loadBlogPostList,
  refreshBlogPostListCache,
  scrapeBlogPostListFromMobileApi,
  type ScrapedBlogPost,
} from './blog-post-list.js';
import { emptyPostContentStats, mergePostContentStats, parsePostContentStats, type PostContentStats } from './content-stats.js';
import {
  BLOG_CHECK_ACCOUNT_GAP_MS,
  BLOG_CHECK_DELTA_HOURS,
  BLOG_CHECK_POST_LIMIT,
  BLOG_CHECK_SCAN_CONCURRENCY,
  type BlogCheckScanMode,
} from './constants.js';
import { computeBlogIndexScore, scrapeBlogStats } from './index-score.js';
import { scrapePostContentStats } from './post-content-scraper.js';
import type { PostExposureStatus } from './exposure-status.js';
import { rankToExposureStatus } from './exposure-status.js';
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
  setupBlogCheckPage,
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

/** posts.ext_link_count 보정 — huma_jobs 본문·link_url 기준 */
async function reconcileExtLinkCountsFromJobs(
  accountId: string,
  posts: Map<string, PostRow>,
  jobs: JobPostSource[] | null,
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
    if (!job) continue;

    const fromJob = resolveExtLinkCount(job.content, job.link_url);
    let next = row.ext_link_count;
    if (fromJob > row.ext_link_count) {
      next = fromJob;
    } else if (row.ext_link_count === 1 && fromJob === 0) {
      next = 0;
    }
    if (next === row.ext_link_count) continue;

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

/** published_at 내림차순 최근 N건 — 블로그 공개 목록 + huma_jobs/posts 병합 */
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
    merged.set(`no:${bp.postNo}`, {
      id: bp.postUrl,
      account_id: accountId,
      post_url: bp.postUrl,
      post_no: bp.postNo,
      title: bp.title,
      published_at: bp.publishedAt ?? new Date(0).toISOString(),
      ext_link_cleared: false,
      ...emptyPostContentStats(),
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

  await reconcileExtLinkCountsFromJobs(accountId, merged, (jobs ?? []) as JobPostSource[]);

  return Array.from(merged.values())
    .sort((a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime())
    .slice(0, POST_LIMIT);
}

function resolveExposureStatusFromRow(row: StatusRow): PostExposureStatus {
  const rank = row.rank != null ? Number(row.rank) : null;
  if (rank != null && rank > 0) return rankToExposureStatus(rank);

  const raw = String(row.status);
  if (raw === 'collect') return 'weak';
  if (raw === 'strong' || raw === 'good' || raw === 'ok' || raw === 'weak' || raw === 'miss') {
    if (raw === 'ok') return 'good';
    return raw;
  }
  return 'miss';
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
      const status = resolveExposureStatusFromRow(row as StatusRow);
      map.set(postNo, { ...(row as StatusRow), status });
    }
  }
  return map;
}

export interface BlogCheckScanOptions {
  mode?: BlogCheckScanMode;
  postNos?: string[];
}

export interface BlogCheckJobPayload {
  accountId?: string | null;
  /** huma_accounts에 없는 블로그 — blogId로 최근 10건 ad-hoc 스캔 */
  blogId?: string | null;
  mode?: BlogCheckScanMode | string | null;
  postNos?: string[] | null;
}

export interface BlogCheckLookupResult {
  blogId: string;
  registered: boolean;
  accountId: string | null;
  label: string | null;
  svc: string | null;
}

export function normalizeBlogCheckScanMode(mode?: string | null): BlogCheckScanMode {
  if (mode === 'delta' || mode === 'posts') return mode;
  return 'full';
}

function postNoFromRow(post: PostRow): string | null {
  return post.post_no ?? extractPostNoFromUrl(post.post_url);
}

function isPostScannedToday(st: StatusRow | undefined, scanDate: string): boolean {
  if (!st?.scanned_at) return false;
  return String(st.scanned_at).slice(0, 10) === scanDate;
}

function isPostPublishedWithinDelta(post: PostRow, hours: number): boolean {
  const ts = Date.parse(post.published_at);
  if (!Number.isFinite(ts)) return false;
  return Date.now() - ts <= hours * 3_600_000;
}

/** full=최근 10건 · delta=24h 이내+오늘 미스캔 · posts=postNos 지정 */
export function selectPostsForScan(
  posts: PostRow[],
  options: BlogCheckScanOptions,
  statusMap: Map<string, StatusRow>,
  scanDate: string,
): PostRow[] {
  const scannable = posts.filter((p) => postNoFromRow(p));
  const mode = normalizeBlogCheckScanMode(options.mode);

  if (mode === 'posts' && options.postNos?.length) {
    const want = new Set(options.postNos.map(String));
    return scannable.filter((p) => {
      const no = postNoFromRow(p);
      return no != null && want.has(no);
    });
  }

  if (mode === 'delta') {
    return scannable.filter((p) => {
      if (isPostScannedToday(statusMap.get(postNoFromRow(p)!), scanDate)) return false;
      return isPostPublishedWithinDelta(p, BLOG_CHECK_DELTA_HOURS);
    });
  }

  return scannable;
}

async function hasTodayBlogIndex(accountId: string, scanDate: string): Promise<boolean> {
  const { data } = await supabase
    .from('blog_index_history')
    .select('id')
    .eq('account_id', accountId)
    .eq('scanned_at', scanDate)
    .limit(1)
    .maybeSingle();
  return data != null;
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

function countScannablePosts(posts: PostRow[]): number {
  return posts.filter((p) => p.post_no ?? extractPostNoFromUrl(p.post_url)).length;
}

async function prepareAccountWorkItem(acc: AccountRow, page: Page): Promise<ScanWorkItem | null> {
  const blogId = resolveBlogId(acc.blog_url, acc.naver_id);
  if (!blogId) {
    await logOperation({
      level: 'warn',
      message: `[blog-check] blogId 없음 — ${acc.name}`,
      account_id: acc.id,
    });
    return null;
  }

  const label = acc.name || acc.slot_label || acc.naver_id;
  await refreshBlogPostListCache(acc.id, blogId, page);
  const posts = await fetchRecentPosts(acc.id, { page, blogId });
  return { acc, blogId, label, posts };
}

async function estimateTotalSteps(
  accounts: AccountRow[],
  options: BlogCheckScanOptions = { mode: 'full' },
): Promise<number> {
  const scanDate = todayKstDate();
  const mode = normalizeBlogCheckScanMode(options.mode);
  let total = 0;
  for (const acc of accounts) {
    const blogId = resolveBlogId(acc.blog_url, acc.naver_id);
    if (!blogId) continue;
    const posts = await fetchRecentPosts(acc.id, { blogId, refreshIfMissing: false });
    const statusMap = await fetchLatestStatusByPostNo(acc.id);
    const selected = selectPostsForScan(posts, options, statusMap, scanDate);
    total += countScannablePosts(selected);
    const skipIndex = mode !== 'full' && (await hasTodayBlogIndex(acc.id, scanDate));
    if (!skipIndex) total += 1;
  }
  return total;
}

function skeletonAdHocPosts(listPosts: PostRow[]): AdHocBlogCheckPost[] {
  const empty = emptyPostContentStats();
  return listPosts.map((post) => {
    const postNo = post.post_no ?? extractPostNoFromUrl(post.post_url);
    return {
      post_url: post.post_url,
      post_no: postNo,
      title: post.title ?? '—',
      published_at: post.published_at,
      status: null,
      rank: null,
      chars: empty.char_count,
      img_count: empty.img_count,
      video_count: empty.video_count,
      quote_count: empty.quote_count,
      comment_count: empty.comment_count,
      like_count: empty.like_count,
      gif_count: empty.gif_count,
      map_count: empty.map_count,
      hidden_count: empty.hidden_count,
      int_link_count: empty.int_link_count,
      ext_link_count: empty.ext_link_count,
    };
  });
}

function mergeScannedIntoSkeleton(
  listPosts: PostRow[],
  scannedByNo: Map<string, AdHocBlogCheckPost>,
): AdHocBlogCheckPost[] {
  const skeleton = skeletonAdHocPosts(listPosts);
  return skeleton.map((p) => {
    if (p.post_no && scannedByNo.has(p.post_no)) return scannedByNo.get(p.post_no)!;
    return p;
  });
}

function scrapedBlogPostToRow(blogId: string, item: ScrapedBlogPost): PostRow {
  const base = emptyPostContentStats();
  return {
    id: item.postUrl,
    account_id: '',
    post_url: item.postUrl,
    post_no: item.postNo,
    title: item.title,
    published_at: item.publishedAt ?? new Date().toISOString(),
    ext_link_cleared: false,
    ...base,
  };
}

function postRowToAdHocResult(
  post: PostRow,
  contentStats: PostContentStats,
  exposure: { status: PostExposureStatus; rank: number | null },
): AdHocBlogCheckPost {
  const postNo = post.post_no ?? extractPostNoFromUrl(post.post_url);
  return {
    post_url: post.post_url,
    post_no: postNo,
    title: post.title ?? '—',
    published_at: post.published_at,
    status: exposure.status,
    rank: exposure.rank,
    chars: contentStats.char_count,
    img_count: contentStats.img_count,
    video_count: contentStats.video_count,
    quote_count: contentStats.quote_count,
    comment_count: contentStats.comment_count,
    like_count: contentStats.like_count,
    gif_count: contentStats.gif_count,
    map_count: contentStats.map_count,
    hidden_count: contentStats.hidden_count,
    int_link_count: contentStats.int_link_count,
    ext_link_count: contentStats.ext_link_count,
  };
}

async function computePostScanResult(
  page: Page,
  blogId: string,
  post: PostRow,
): Promise<{
  contentStats: PostContentStats;
  exposure: { status: PostExposureStatus; rank: number | null };
}> {
  const postNo = post.post_no ?? extractPostNoFromUrl(post.post_url);
  if (!postNo) throw new Error('post_no 없음');

  const title = post.title?.trim() || '—';
  const crawled = await scrapePostContentStats(page, blogId, postNo);
  const rankResult = await checkPostExposure(page, blogId, postNo, title);
  const hasStoredContent = post.char_count > 0 || post.img_count > 0;
  const fromPost: PostContentStats = {
    char_count: post.char_count,
    img_count: post.img_count,
    video_count: post.video_count,
    quote_count: post.quote_count,
    comment_count: post.comment_count,
    like_count: post.like_count,
    gif_count: post.gif_count,
    map_count: post.map_count,
    hidden_count: post.hidden_count,
    int_link_count: post.int_link_count,
    ext_link_count: hasStoredContent && !post.ext_link_cleared ? post.ext_link_count : 0,
  };
  const contentStats =
    crawled.char_count >= 80
      ? {
          ...crawled,
          ext_link_count: post.ext_link_cleared ? 0 : crawled.ext_link_count,
        }
      : hasStoredContent
        ? mergePostContentStats(fromPost, crawled)
        : crawled;
  const exposure = {
    status: rankResult.rank != null ? rankToExposureStatus(rankResult.rank) : rankResult.status,
    rank: rankResult.rank,
  };
  return { contentStats, exposure };
}

async function scanSinglePost(
  page: Page,
  acc: AccountRow,
  blogId: string,
  post: PostRow,
  scanDate: string,
): Promise<boolean> {
  const postNo = post.post_no ?? extractPostNoFromUrl(post.post_url);
  if (!postNo) return false;

  const { contentStats, exposure } = await computePostScanResult(page, blogId, post);

  const { error: insErr } = await supabase.from('blog_post_status').insert({
    account_id: acc.id,
    post_url: post.post_url,
    post_no: postNo,
    title: post.title,
    scanned_at: scanDate,
    ...statusInsertPayload(contentStats, exposure, post.ext_link_cleared),
  });

  if (insErr) throw new Error(`blog_post_status insert 실패: ${insErr.message}`);
  await persistCrawledPostStats(acc.id, post, contentStats);
  return true;
}

async function scanSinglePostAdHoc(
  page: Page,
  blogId: string,
  post: PostRow,
): Promise<AdHocBlogCheckPost | null> {
  const postNo = post.post_no ?? extractPostNoFromUrl(post.post_url);
  if (!postNo) return null;
  const { contentStats, exposure } = await computePostScanResult(page, blogId, post);
  return postRowToAdHocResult(post, contentStats, exposure);
}

async function createPostScanWorkerPages(primary: Page, poolSize: number): Promise<Page[]> {
  const workers: Page[] = [primary];
  const ctx = primary.context();
  for (let i = 1; i < poolSize; i++) {
    const worker = await ctx.newPage();
    await setupBlogCheckPage(worker);
    workers.push(worker);
  }
  return workers;
}

async function closeExtraWorkerPages(workers: Page[]): Promise<void> {
  for (let i = 1; i < workers.length; i++) {
    await workers[i]!.close().catch(() => {});
  }
}

async function scanAccountWorkItem(
  page: Page,
  item: ScanWorkItem,
  scanDate: string,
  onStep: (accountId: string, label: string) => Promise<void>,
  options: BlogCheckScanOptions = { mode: 'full' },
): Promise<{ scannedPosts: number; aborted: boolean }> {
  const { acc, blogId, label, posts } = item;
  const mode = normalizeBlogCheckScanMode(options.mode);
  let accountAborted = false;
  let scannedPosts = 0;

  const statusMap = await fetchLatestStatusByPostNo(acc.id);
  const scannablePosts = selectPostsForScan(posts, options, statusMap, scanDate);
  const skipIndex = mode !== 'full' && (await hasTodayBlogIndex(acc.id, scanDate));

  let parsed: Awaited<ReturnType<typeof scrapeBlogStats>> | null = null;
  if (!skipIndex) {
    parsed = await scrapeBlogStats(page, blogId);
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

    await onStep(acc.id, label);
  }

  const postNosToClear = scannablePosts
    .map((p) => postNoFromRow(p))
    .filter((n): n is string => Boolean(n));
  if (postNosToClear.length > 0) {
    const { error: clearErr } = await supabase
      .from('blog_post_status')
      .delete()
      .eq('account_id', acc.id)
      .in('post_no', postNosToClear);
    if (clearErr) {
      await logOperation({
        level: 'warn',
        message: `[blog-check] 이전 스캔 상태 삭제 실패: ${clearErr.message}`,
        account_id: acc.id,
      });
    }
  }

  if (scannablePosts.length === 0) {
    await logOperation({
      level: 'info',
      message: `[blog-check] ${label} — 스캔 대상 없음 (mode=${mode})`,
      account_id: acc.id,
    });
    return { scannedPosts: 0, aborted: accountAborted };
  }

  const poolSize = Math.min(BLOG_CHECK_SCAN_CONCURRENCY, Math.max(1, scannablePosts.length));
  const workerPages = await createPostScanWorkerPages(page, poolSize);

  try {
    for (let i = 0; i < scannablePosts.length && !accountAborted; i += poolSize) {
      const batch = scannablePosts.slice(i, i + poolSize);
      const outcomes = await Promise.all(
        batch.map(async (post, j) => {
          try {
            const scanned = await scanSinglePost(workerPages[j]!, acc, blogId, post, scanDate);
            return { scanned, captcha: false, error: null as Error | null };
          } catch (err) {
            if (err instanceof BlogCheckCaptchaError) {
              return { scanned: false, captcha: true, error: err };
            }
            return { scanned: false, captcha: false, error: err as Error };
          }
        }),
      );

      for (const outcome of outcomes) {
        if (outcome.error && !outcome.captcha) throw outcome.error;
        if (outcome.scanned) scannedPosts += 1;
        await onStep(acc.id, label);
      }

      if (outcomes.some((o) => o.captcha)) {
        if (!accountAborted) {
          await notifyBlogCheckCaptcha(blogId, label, acc.workspace);
          await logOperation({
            level: 'warn',
            message: `[blog-check] 캡차 감지 — ${label} 스캔 중단`,
            account_id: acc.id,
          });
        }
        accountAborted = true;
      }

      if (accountAborted) break;
      if (i + poolSize < scannablePosts.length) await sleep(randomScanDelayMs());
    }
  } finally {
    await closeExtraWorkerPages(workerPages);
  }

  await logOperation({
    level: 'info',
    message: `[blog-check] ${label} — 포스트 ${scannablePosts.length}/${posts.length}건(mode=${mode}) · 지수 ${parsed ? computeBlogIndexScore(parsed.stats) : skipIndex ? '생략' : 'null'}`,
    account_id: acc.id,
  });

  return { scannedPosts, aborted: accountAborted };
}

export async function findBlogCheckAccountByQuery(
  query: string,
  allowedWorkspaces: string[],
): Promise<{ account: AccountRow; blogId: string } | null> {
  const parsedBlogId = parseBlogCheckSearchQuery(query);
  const q = query.trim().toLowerCase();
  if (!q && !parsedBlogId) return null;

  const accounts = (await listActivePostingAccounts()).filter((a) =>
    allowedWorkspaces.includes(a.workspace),
  );

  if (parsedBlogId) {
    const exact = accounts.find((acc) => {
      const bid = resolveBlogId(acc.blog_url, acc.naver_id);
      return bid?.toLowerCase() === parsedBlogId.toLowerCase();
    });
    if (exact) {
      return { account: exact, blogId: resolveBlogId(exact.blog_url, exact.naver_id)! };
    }
  }

  const byNaverId = accounts.find((acc) => acc.naver_id?.toLowerCase() === q);
  if (byNaverId) {
    const blogId = resolveBlogId(byNaverId.blog_url, byNaverId.naver_id);
    if (blogId) return { account: byNaverId, blogId };
  }

  const byLabel = accounts.find((acc) => {
    const label = (acc.name || acc.slot_label || '').toLowerCase();
    return label && label.includes(q);
  });
  if (byLabel) {
    const blogId = resolveBlogId(byLabel.blog_url, byLabel.naver_id);
    if (blogId) return { account: byLabel, blogId };
  }

  return null;
}

export async function resolveBlogCheckLookup(
  query: string,
  allowedWorkspaces: string[],
): Promise<BlogCheckLookupResult | null> {
  const blogId = parseBlogCheckSearchQuery(query);
  if (!blogId) return null;

  const match = await findBlogCheckAccountByQuery(query, allowedWorkspaces);
  if (match) {
    const label = match.account.name || match.account.slot_label || match.account.naver_id;
    return {
      blogId: match.blogId,
      registered: true,
      accountId: match.account.id,
      label,
      svc: WS_LABEL[match.account.workspace] ?? match.account.workspace,
    };
  }

  return {
    blogId,
    registered: false,
    accountId: null,
    label: blogId,
    svc: null,
  };
}

async function runBlogCheckAdHocScan(
  blogId: string,
  options: BlogCheckScanOptions = { mode: 'full' },
): Promise<{ scannedAccounts: number; scannedPosts: number }> {
  const scanDate = todayKstDate();
  const scanOptions = { ...options, mode: normalizeBlogCheckScanMode(options.mode) };
  const label = blogId;
  let scannedPosts = 0;
  let accountAborted = false;
  const adHocResults: AdHocBlogCheckPost[] = [];
  let idxScore: number | null = null;
  let listPosts: PostRow[] = [];

  await withBlogCheckBrowser(async (page) => {
    const scraped = await scrapeBlogPostListFromMobileApi(page, blogId, POST_LIMIT);
    const posts = scraped.map((item) => scrapedBlogPostToRow(blogId, item));
    listPosts = posts;

    await setAdHocBlogCheckCache(blogId, {
      blogId,
      idxScore: null,
      scannedAt: scanDate,
      posts: skeletonAdHocPosts(listPosts),
    });

    const statusMap = new Map<string, StatusRow>();
    const scannablePosts = selectPostsForScan(posts, scanOptions, statusMap, scanDate);
    const totalSteps = Math.max(countScannablePosts(scannablePosts) + 1, 1);
    let completedSteps = 0;

    await reportScanProgress({
      accountId: null,
      accountLabel: label,
      completed: completedSteps,
      total: totalSteps,
      phase: 'preparing',
    });

    const onStep = async () => {
      completedSteps += 1;
      await reportScanProgress({
        accountId: null,
        accountLabel: label,
        completed: completedSteps,
        total: totalSteps,
        phase: 'scanning',
      });
    };

    const parsed = await scrapeBlogStats(page, blogId);
    if (parsed) {
      idxScore = computeBlogIndexScore(parsed.stats);
    }

    await setAdHocBlogCheckCache(blogId, {
      blogId,
      idxScore,
      scannedAt: scanDate,
      posts: skeletonAdHocPosts(listPosts),
    });

    if (await detectBlogCheckCaptcha(page)) {
      await notifyBlogCheckCaptcha(blogId, label, null);
      accountAborted = true;
    }

    await onStep();

    if (scannablePosts.length === 0) {
      await logOperation({
        level: 'info',
        message: `[blog-check] ${label} — ad-hoc 스캔 대상 없음 (mode=${scanOptions.mode})`,
      });
    } else {
      const poolSize = Math.min(BLOG_CHECK_SCAN_CONCURRENCY, Math.max(1, scannablePosts.length));
      const workerPages = await createPostScanWorkerPages(page, poolSize);

      try {
        for (let i = 0; i < scannablePosts.length && !accountAborted; i += poolSize) {
          const batch = scannablePosts.slice(i, i + poolSize);
          const outcomes = await Promise.all(
            batch.map(async (post, j) => {
              try {
                const scanned = await scanSinglePostAdHoc(workerPages[j]!, blogId, post);
                return { scanned, captcha: false, error: null as Error | null };
              } catch (err) {
                if (err instanceof BlogCheckCaptchaError) {
                  return { scanned: null, captcha: true, error: err };
                }
                return { scanned: null, captcha: false, error: err as Error };
              }
            }),
          );

          for (const outcome of outcomes) {
            if (outcome.error && !outcome.captcha) throw outcome.error;
            if (outcome.scanned) {
              adHocResults.push(outcome.scanned);
              scannedPosts += 1;
            }
            await onStep();
          }

          const scannedByNo = new Map(
            adHocResults.filter((r) => r.post_no).map((r) => [r.post_no as string, r]),
          );
          await setAdHocBlogCheckCache(blogId, {
            blogId,
            idxScore,
            scannedAt: scanDate,
            posts: mergeScannedIntoSkeleton(listPosts, scannedByNo),
          });

          if (outcomes.some((o) => o.captcha)) {
            if (!accountAborted) {
              await notifyBlogCheckCaptcha(blogId, label, null);
              await logOperation({
                level: 'warn',
                message: `[blog-check] 캡차 감지 — ${label} ad-hoc 스캔 중단`,
              });
            }
            accountAborted = true;
          }

          if (accountAborted) break;
          if (i + poolSize < scannablePosts.length) await sleep(randomScanDelayMs());
        }
      } finally {
        await closeExtraWorkerPages(workerPages);
      }

      await logOperation({
        level: 'info',
        message: `[blog-check] ${label} — ad-hoc 포스트 ${scannablePosts.length}/${posts.length}건 · 지수 ${idxScore ?? 'null'}`,
      });
    }
  });

  if (listPosts.length > 0) {
    const scannedByNo = new Map(
      adHocResults.filter((r) => r.post_no).map((r) => [r.post_no as string, r]),
    );
    await setAdHocBlogCheckCache(blogId, {
      blogId,
      idxScore,
      scannedAt: scanDate,
      posts: mergeScannedIntoSkeleton(listPosts, scannedByNo),
    });
  }

  if (listPosts.length > 0) {
    await reportScanProgress({
      accountId: null,
      accountLabel: label,
      completed: 1,
      total: 1,
      phase: 'done',
    });
  }

  return { scannedAccounts: accountAborted ? 0 : 1, scannedPosts };
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

export async function runBlogCheckScan(
  accountId?: string,
  options: BlogCheckScanOptions = { mode: 'full' },
  adHocBlogId?: string,
): Promise<{
  scannedAccounts: number;
  scannedPosts: number;
}> {
  if (adHocBlogId && !accountId) {
    return runBlogCheckAdHocScan(adHocBlogId, options);
  }

  const scanDate = todayKstDate();
  const scanOptions = { ...options, mode: normalizeBlogCheckScanMode(options.mode) };
  let scannedAccounts = 0;
  let scannedPosts = 0;

  const accounts = await listActivePostingAccounts(accountId);
  if (!accounts.length) return { scannedAccounts: 0, scannedPosts: 0 };

  const totalSteps = await estimateTotalSteps(accounts, scanOptions);
  let completedSteps = 0;
  const isolateByAccount = !accountId;

  await reportScanProgress({
    accountId: accountId ?? null,
    completed: 0,
    total: Math.max(totalSteps, 1),
    phase: 'preparing',
  });

  const onStep = async (accId: string, label: string) => {
    completedSteps += 1;
    await reportScanProgress({
      accountId: accId,
      accountLabel: label,
      completed: completedSteps,
      total: Math.max(totalSteps, 1),
      phase: 'scanning',
    });
  };

  const runAccountScan = async (acc: AccountRow) => {
    await withBlogCheckBrowser(async (page) => {
      const item = await prepareAccountWorkItem(acc, page);
      if (!item) return;
      const result = await scanAccountWorkItem(page, item, scanDate, onStep, scanOptions);
      scannedPosts += result.scannedPosts;
      if (!result.aborted) scannedAccounts += 1;
    });
  };

  if (isolateByAccount) {
    for (let i = 0; i < accounts.length; i++) {
      await runAccountScan(accounts[i]);
      if (i < accounts.length - 1) await sleep(BLOG_CHECK_ACCOUNT_GAP_MS);
    }
  } else {
    await withBlogCheckBrowser(async (page) => {
      for (const acc of accounts) {
        const item = await prepareAccountWorkItem(acc, page);
        if (!item) continue;
        const result = await scanAccountWorkItem(page, item, scanDate, onStep, scanOptions);
        scannedPosts += result.scannedPosts;
        if (!result.aborted) scannedAccounts += 1;
      }
    });
  }

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

export async function requestBlogCheckScan(
  accountId?: string,
  options: BlogCheckScanOptions = { mode: 'full' },
  adHocBlogId?: string,
): Promise<{ queued: true; accountId?: string; blogId?: string; mode: BlogCheckScanMode; registered?: boolean }> {
  if (!(await acquireBlogCheckScanLock())) {
    throw new Error('SCAN_ALREADY_RUNNING');
  }

  const mode = normalizeBlogCheckScanMode(options.mode);
  try {
    await enqueueJob({
      type: 'blog_check',
      payload: {
        accountId: accountId ?? null,
        blogId: adHocBlogId ?? null,
        mode,
        postNos: options.postNos ?? null,
      },
    });
    return { queued: true, accountId, blogId: adHocBlogId, mode, registered: Boolean(accountId) };
  } catch (err) {
    await releaseBlogCheckScanLock();
    throw err;
  }
}

export async function requestBlogCheckSearchScan(
  query: string,
  allowedWorkspaces: string[],
): Promise<{
  queued: true;
  accountId?: string;
  blogId: string;
  mode: BlogCheckScanMode;
  registered: boolean;
  label: string | null;
}> {
  const lookup = await resolveBlogCheckLookup(query, allowedWorkspaces);
  if (!lookup) {
    throw new Error('블로그 ID를 인식할 수 없습니다');
  }

  if (lookup.registered && lookup.accountId) {
    const result = await requestBlogCheckScan(lookup.accountId, { mode: 'full' });
    return {
      ...result,
      blogId: lookup.blogId,
      registered: true,
      label: lookup.label,
    };
  }

  const result = await requestBlogCheckScan(undefined, { mode: 'full' }, lookup.blogId);
  return {
    ...result,
    blogId: lookup.blogId,
    registered: false,
    label: lookup.label,
  };
}

export async function executeBlogCheckJob(payload: BlogCheckJobPayload) {
  const options: BlogCheckScanOptions = {
    mode: normalizeBlogCheckScanMode(payload.mode),
    postNos: payload.postNos?.filter(Boolean) ?? undefined,
  };
  try {
    return await runBlogCheckScan(
      payload.accountId ?? undefined,
      options,
      payload.blogId ?? undefined,
    );
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

  const posts = await fetchRecentPosts(accountId, { blogId, refreshIfMissing: false });
  const statusMap = await fetchLatestStatusByPostNo(accountId);

  return {
    posts: posts.map((post) => {
      const postNo = post.post_no ?? extractPostNoFromUrl(post.post_url) ?? '';
      const st = postNo ? statusMap.get(postNo) : undefined;
      const stats = st
        ? statsFromStatusRow(st, post.ext_link_cleared)
        : statsFromDbRow(post as unknown as Record<string, unknown>, workspace);
      const displayStatus = st ? resolveExposureStatusFromRow(st) : null;

      return {
        post_url: post.post_url,
        post_no: postNo || null,
        title: post.title ?? '—',
        published_at: post.published_at,
        status: displayStatus,
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

export async function buildBlogCheckPostsByBlogResponse(blogId: string) {
  const normalized = parseBlogCheckSearchQuery(blogId) ?? blogId.trim();
  if (!normalized) {
    return { blogId: '', registered: false, idxScore: null, posts: [] as AdHocBlogCheckPost[] };
  }

  const cache = await getAdHocBlogCheckCache(normalized);
  return {
    blogId: normalized,
    registered: false,
    idxScore: cache?.idxScore ?? null,
    scannedAt: cache?.scannedAt ?? null,
    posts: cache?.posts ?? [],
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
