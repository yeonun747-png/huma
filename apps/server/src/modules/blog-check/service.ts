import { supabase } from '../../middleware/auth.js';
import { formatKstDateKey, getKstClock } from '../../lib/crank-schedule-config.js';
import { logOperation } from '../../lib/log-emitter.js';
import { enqueueJob } from '../queue/producer.js';
import { extractBlogIdFromUrl, extractPostNoFromUrl } from './blog-url.js';
import { computeBlogIndexScore, scrapeBlogStats } from './index-score.js';
import { inferMissReason, type MissReason } from './miss-reason.js';
import {
  acquireBlogCheckScanLock,
  isBlogCheckScanLocked,
  releaseBlogCheckScanLock,
} from './scan-lock.js';
import { checkPostIndexed, resolveBlogId, withBlogCheckBrowser } from './scanner.js';

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

const LOOKBACK_DAYS = 30;

interface AccountRow {
  id: string;
  name: string;
  naver_id: string;
  blog_url: string | null;
  workspace: string;
  slot_label: string | null;
  health_score: number | null;
  proxy_port: number | null;
}

interface PostRow {
  id: string;
  account_id: string;
  post_url: string;
  post_no: string | null;
  title: string | null;
  published_at: string;
  char_count: number;
  img_count: number;
  ext_link_count: number;
  ext_link_cleared: boolean;
}

interface StatusRow {
  post_no: string;
  status: 'ok' | 'miss';
  scanned_at: string;
  chars: number;
  img_count: number;
  ext_link_count: number;
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

function formatPostDate(iso: string): string {
  const d = new Date(iso);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${mm}.${dd}`;
}

function trendDirection(trend: number[]): '안정' | '악화' | '개선' {
  if (trend.every((v) => v === 0)) return '안정';
  const first = trend[0] ?? 0;
  const last = trend[trend.length - 1] ?? 0;
  if (last > first) return '악화';
  if (last < first) return '개선';
  return '안정';
}

async function listActivePostingAccounts(accountId?: string): Promise<AccountRow[]> {
  let q = supabase
    .from('huma_accounts')
    .select('id, name, naver_id, blog_url, workspace, slot_label, health_score, proxy_port')
    .eq('account_type', 'posting')
    .eq('is_active', true);

  if (accountId) q = q.eq('id', accountId);

  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return sortAccounts((data ?? []) as AccountRow[]);
}

async function fetchRecentPosts(accountId: string): Promise<PostRow[]> {
  const since = new Date();
  since.setDate(since.getDate() - LOOKBACK_DAYS);

  const { data, error } = await supabase
    .from('posts')
    .select('*')
    .eq('account_id', accountId)
    .gte('published_at', since.toISOString())
    .order('published_at', { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []) as PostRow[];
}

async function fetchLatestStatusByPostNo(accountId: string): Promise<Map<string, StatusRow>> {
  const { data, error } = await supabase
    .from('blog_post_status')
    .select('post_no, status, scanned_at, chars, img_count, ext_link_count')
    .eq('account_id', accountId)
    .order('scanned_at', { ascending: false });

  if (error) throw new Error(error.message);

  const map = new Map<string, StatusRow>();
  for (const row of data ?? []) {
    const postNo = String(row.post_no);
    if (!map.has(postNo)) map.set(postNo, row as StatusRow);
  }
  return map;
}

async function buildSevenDayMissTrend(accountId: string): Promise<number[]> {
  const since = new Date();
  since.setDate(since.getDate() - 6);
  since.setHours(0, 0, 0, 0);

  const { data, error } = await supabase
    .from('blog_post_status')
    .select('scanned_at, status')
    .eq('account_id', accountId)
    .eq('status', 'miss')
    .gte('scanned_at', formatKstDateKey(since));

  if (error) return Array(7).fill(0);

  const counts = new Map<string, number>();
  for (let i = 0; i < 7; i++) {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    counts.set(formatKstDateKey(d), 0);
  }

  for (const row of data ?? []) {
    const day = String(row.scanned_at).slice(0, 10);
    if (counts.has(day)) counts.set(day, (counts.get(day) ?? 0) + 1);
  }

  return Array.from(counts.values());
}

async function sessionStatus(accountId: string, healthScore: number | null): Promise<'정상' | '오류'> {
  if ((healthScore ?? 100) < 50) return '오류';
  const since = new Date();
  since.setDate(since.getDate() - 3);
  const { count } = await supabase
    .from('huma_jobs')
    .select('*', { count: 'exact', head: true })
    .eq('account_id', accountId)
    .eq('job_type', 'post_blog')
    .eq('status', 'failed')
    .gte('created_at', since.toISOString());
  return (count ?? 0) >= 2 ? '오류' : '정상';
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

  await withBlogCheckBrowser(async (page) => {
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

      const posts = await fetchRecentPosts(acc.id);

      const stats = await scrapeBlogStats(page, blogId);
      if (stats) {
        const idxScore = computeBlogIndexScore(stats);
        const { error: idxErr } = await supabase.from('blog_index_history').insert({
          account_id: acc.id,
          scanned_at: scanDate,
          idx_score: idxScore,
          visitor_count: stats.visitorCount,
          buddy_count: stats.buddyCount,
          post_count: stats.postCount,
        });
        if (idxErr) {
          await logOperation({
            level: 'warn',
            message: `[blog-check] blog_index_history insert: ${idxErr.message}`,
            account_id: acc.id,
          });
        }
      }

      for (const post of posts) {
        const postNo = post.post_no ?? extractPostNoFromUrl(post.post_url);
        if (!postNo) continue;

        const indexed = await checkPostIndexed(page, blogId, postNo);
        const status = indexed ? 'ok' : 'miss';
        const extCount = post.ext_link_cleared ? 0 : post.ext_link_count;

        const { error: insErr } = await supabase.from('blog_post_status').insert({
          account_id: acc.id,
          post_url: post.post_url,
          post_no: postNo,
          title: post.title,
          scanned_at: scanDate,
          status,
          chars: post.char_count,
          img_count: post.img_count,
          ext_link_count: extCount,
        });

        if (insErr) {
          throw new Error(`blog_post_status insert 실패: ${insErr.message}`);
        }
        scannedPosts += 1;
      }

      scannedAccounts += 1;
      await logOperation({
        level: 'info',
        message: `[blog-check] ${acc.name} — 포스트 ${posts.length}건 · 지수 ${stats ? computeBlogIndexScore(stats) : '—'}`,
        account_id: acc.id,
      });
    }
  });

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
  }
}

export async function getBlogCheckScanState() {
  return {
    scanning: await isBlogCheckScanLocked(),
    lastScanAt: null as string | null,
  };
}

export async function buildBlogCheckAccountsResponse(allowedWorkspaces: string[]) {
  const accounts = sortAccounts(
    (await listActivePostingAccounts()).filter((a) => allowedWorkspaces.includes(a.workspace)),
  );

  const result = [];
  for (const acc of accounts) {
    const blogId = extractBlogIdFromUrl(acc.blog_url, acc.naver_id) ?? acc.naver_id;
    const recentPosts = await fetchRecentPosts(acc.id);
    const statusMap = await fetchLatestStatusByPostNo(acc.id);

    let okCount = 0;
    let missCount = 0;
    for (const post of recentPosts) {
      const postNo = post.post_no ?? extractPostNoFromUrl(post.post_url);
      if (!postNo) continue;
      const st = statusMap.get(postNo);
      if (!st) continue;
      if (st.status === 'ok') okCount += 1;
      else missCount += 1;
    }

    const totalPosts = recentPosts.length;
    const missRate = totalPosts > 0 ? Math.round((missCount / totalPosts) * 100) : 0;
    const trend = await buildSevenDayMissTrend(acc.id);

    const { data: idxRow } = await supabase
      .from('blog_index_history')
      .select('idx_score, scanned_at')
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
      ok_count: okCount,
      miss_count: missCount,
      miss_rate: missRate,
      trend,
      trend_direction: trendDirection(trend),
      session_status: await sessionStatus(acc.id, acc.health_score),
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

  return {
    accounts: result,
    lastScanAt,
    scanning: await isBlogCheckScanLocked(),
  };
}

export async function buildBlogCheckPostsResponse(accountId: string) {
  const posts = await fetchRecentPosts(accountId);
  const statusMap = await fetchLatestStatusByPostNo(accountId);
  const publishTimes = posts.map((p) => p.published_at);

  return {
    posts: posts.map((post) => {
      const postNo = post.post_no ?? extractPostNoFromUrl(post.post_url) ?? '';
      const st = postNo ? statusMap.get(postNo) : undefined;
      const extCount = post.ext_link_cleared ? 0 : post.ext_link_count;
      const status = st?.status ?? null;
      let missReason: MissReason | '—' = '—';
      if (status === 'miss') {
        missReason = inferMissReason({
          extLinkCount: extCount,
          charCount: post.char_count,
          recentPublishTimes: publishTimes,
        });
      }

      return {
        post_url: post.post_url,
        title: post.title ?? '—',
        published_at: post.published_at,
        date: formatPostDate(post.published_at),
        chars: post.char_count,
        img_count: post.img_count,
        ext_link_count: extCount,
        status,
        miss_reason: missReason,
      };
    }),
  };
}

export async function clearPostExtLinkFlag(accountId: string, postUrl: string): Promise<void> {
  const { error } = await supabase
    .from('posts')
    .update({ ext_link_count: 0, ext_link_cleared: true })
    .eq('account_id', accountId)
    .eq('post_url', postUrl);

  if (error) throw new Error(error.message);
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
