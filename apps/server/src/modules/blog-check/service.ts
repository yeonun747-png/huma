import { supabase } from '../../middleware/auth.js';
import { formatKstDateKey, getKstClock } from '../../lib/crank-schedule-config.js';
import { logOperation } from '../../lib/log-emitter.js';
import { enqueueJob } from '../queue/producer.js';
import {
  countExternalLinks,
  extractBlogIdFromUrl,
  extractPostNoFromUrl,
  plainTextLength,
} from './blog-url.js';
import { resolveBlogId, resolvePostNo, scrapeBlogIndexScore, withBlogCheckBrowser, scanPostsIndexed } from './scanner.js';

const WS_LABEL: Record<string, string> = {
  yeonun: '연운',
  quizoasis: '퀴즈',
  panana: '파나나',
};

type ScanState = {
  running: boolean;
  accountId?: string;
  startedAt: string | null;
  progress: { done: number; total: number };
  lastCompletedAt: string | null;
  lastError: string | null;
};

const scanState: ScanState = {
  running: false,
  startedAt: null,
  progress: { done: 0, total: 0 },
  lastCompletedAt: null,
  lastError: null,
};

export function getBlogCheckScanState(): ScanState {
  return { ...scanState, progress: { ...scanState.progress } };
}

function setScanProgress(done: number, total: number) {
  scanState.progress = { done, total };
}

interface PublishedPostRow {
  id: string;
  title: string | null;
  result_url: string;
  link_url: string | null;
  content: string | null;
  image_urls: string[] | null;
  completed_at: string | null;
  scheduled_at: string | null;
  created_at: string | null;
}

interface AccountRow {
  id: string;
  name: string;
  naver_id: string;
  blog_url: string | null;
  workspace: string;
  slot_label: string | null;
  blog_index: number | null;
  health_score: number | null;
  is_active: boolean;
  proxy_port: number | null;
}

const BLOG_CHECK_LOOKBACK_DAYS = 30;

const WORKSPACE_SORT: Record<string, number> = {
  yeonun: 0,
  panana: 1,
  quizoasis: 2,
};

function sortBlogCheckAccounts(accounts: AccountRow[]): AccountRow[] {
  return [...accounts].sort((a, b) => {
    const ws = (WORKSPACE_SORT[a.workspace] ?? 9) - (WORKSPACE_SORT[b.workspace] ?? 9);
    if (ws !== 0) return ws;
    return (a.proxy_port ?? 999) - (b.proxy_port ?? 999);
  });
}

function jobPublishedAt(row: PublishedPostRow): Date | null {
  const raw = row.completed_at ?? row.scheduled_at ?? null;
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function isPublishableJobRow(row: PublishedPostRow): boolean {
  const url = row.result_url?.trim() ?? '';
  if (!url) return false;
  return /blog\.naver\.com|logNo=/i.test(url);
}

async function listActivePostingAccounts(accountId?: string): Promise<AccountRow[]> {
  let q = supabase
    .from('huma_accounts')
    .select(
      'id, name, naver_id, blog_url, workspace, slot_label, blog_index, health_score, is_active, proxy_port',
    )
    .eq('account_type', 'posting')
    .eq('is_active', true);

  if (accountId) q = q.eq('id', accountId);

  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return sortBlogCheckAccounts((data ?? []) as AccountRow[]);
}

async function fetchRecentPublishedPosts(accountId: string): Promise<PublishedPostRow[]> {
  const since = new Date();
  since.setDate(since.getDate() - BLOG_CHECK_LOOKBACK_DAYS);

  const { data, error } = await supabase
    .from('huma_jobs')
    .select('id, title, result_url, link_url, content, image_urls, completed_at, scheduled_at, created_at')
    .eq('account_id', accountId)
    .eq('job_type', 'post_blog')
    .eq('status', 'completed')
    .order('completed_at', { ascending: false, nullsFirst: false })
    .limit(80);

  if (error) throw new Error(error.message);

  return ((data ?? []) as PublishedPostRow[]).filter((row) => {
    if (!isPublishableJobRow(row)) return false;
    const at = jobPublishedAt(row) ?? (row.created_at ? new Date(row.created_at) : null);
    if (!at || Number.isNaN(at.getTime())) return false;
    return at >= since;
  });
}

function detectRegularPostingInterval(times: string[]): boolean {
  if (times.length < 5) return false;
  const minutes = times
    .map((t) => {
      const d = new Date(t);
      return d.getHours() * 60 + d.getMinutes();
    })
    .filter((m) => Number.isFinite(m));
  if (minutes.length < 5) return false;
  const avg = minutes.reduce((a, b) => a + b, 0) / minutes.length;
  const within = minutes.filter((m) => Math.abs(m - avg) <= 35).length;
  return within / minutes.length >= 0.75;
}

function inferMissReason(extLinkCount: number, publishTimes: string[]): string | null {
  if (extLinkCount > 0) return '외부링크 포함';
  if (detectRegularPostingInterval(publishTimes)) return '발행간격 규칙적';
  return 'AI패턴 의심';
}

function missRatePattern(miss: number, posts: number): '낮음' | '중간' | '높음' {
  if (posts <= 0) return '낮음';
  const rate = miss / posts;
  if (rate >= 0.2) return '높음';
  if (rate >= 0.1) return '중간';
  return '낮음';
}

function formatPostDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${mm}.${dd}`;
}

async function buildSevenDayMissTrend(accountId: string): Promise<number[]> {
  const trend: number[] = [];
  const now = new Date();
  for (let i = 6; i >= 0; i--) {
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);
    dayStart.setDate(dayStart.getDate() - i);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    const { count, error } = await supabase
      .from('blog_post_status')
      .select('*', { count: 'exact', head: true })
      .eq('account_id', accountId)
      .eq('status', 'miss')
      .gte('published_at', dayStart.toISOString())
      .lt('published_at', dayEnd.toISOString());

    trend.push(error ? 0 : (count ?? 0));
  }
  return trend;
}

async function sessionLabel(accountId: string, healthScore: number | null): Promise<'정상' | '오류'> {
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

export async function runBlogCheckScan(accountId?: string): Promise<{ scannedAccounts: number; scannedPosts: number }> {
  scanState.running = true;
  scanState.accountId = accountId;
  if (!scanState.startedAt) scanState.startedAt = new Date().toISOString();
  scanState.lastError = null;
  setScanProgress(0, 0);

  let scannedAccounts = 0;
  let scannedPosts = 0;

  try {
    const accounts = await listActivePostingAccounts(accountId);
    if (!accounts.length) return { scannedAccounts: 0, scannedPosts: 0 };

    const allPostsByAccount = new Map<string, PublishedPostRow[]>();
    let totalPosts = 0;
    for (const acc of accounts) {
      const posts = await fetchRecentPublishedPosts(acc.id);
      allPostsByAccount.set(acc.id, posts);
      totalPosts += posts.length;
    }
    setScanProgress(0, totalPosts);

    await withBlogCheckBrowser(async (page) => {
      let donePosts = 0;

      for (const acc of accounts) {
        const blogId = resolveBlogId(acc.blog_url, acc.naver_id);
        if (!blogId) {
          await logOperation({
            level: 'warn',
            message: `[blog-check] blogId 없음 — ${acc.name}`,
            account_id: acc.id,
          });
          scannedAccounts += 1;
          continue;
        }

        const posts = allPostsByAccount.get(acc.id) ?? [];
        const publishTimes = posts.map((p) => p.completed_at ?? p.scheduled_at ?? '').filter(Boolean);

        const postRows = posts
          .map((p) => {
            const postNo = resolvePostNo(p.result_url, blogId) ?? extractPostNoFromUrl(p.result_url);
            if (!postNo) return null;
            return { post: p, postNo };
          })
          .filter((x): x is { post: PublishedPostRow; postNo: string } => x !== null);

        if (posts.length > 0 && postRows.length === 0) {
          await logOperation({
            level: 'warn',
            message: `[blog-check] ${acc.name} — 발행 ${posts.length}건 중 URL 파싱 실패 (result_url 확인)`,
            account_id: acc.id,
          });
        }

        const indexResults = await scanPostsIndexed(
          page,
          blogId,
          postRows.map((r) => ({ postNo: r.postNo })),
          (done) => setScanProgress(donePosts + done, totalPosts),
        );

        const idxScore = await scrapeBlogIndexScore(page, blogId);
        const blogUrl = acc.blog_url ?? `https://blog.naver.com/${blogId}`;
        const checkedAt = new Date().toISOString();

        await supabase.from('blog_accounts').upsert(
          {
            account_id: acc.id,
            blog_url: blogUrl,
            idx_score: idxScore ?? acc.blog_index ?? null,
            checked_at: checkedAt,
          },
          { onConflict: 'account_id' },
        );

        if (idxScore != null) {
          await supabase.from('huma_accounts').update({ blog_index: idxScore }).eq('id', acc.id);
        }

        for (const { post, postNo } of postRows) {
          const indexed = indexResults.get(postNo) ?? false;
          const chars = plainTextLength(post.content);
          const imgCount = post.image_urls?.length ?? 0;
          const extLinkCount = countExternalLinks(post.content, post.link_url);
          const status = indexed ? 'ok' : 'miss';
          const missReason = status === 'miss' ? inferMissReason(extLinkCount, publishTimes) : null;

          const { error: upsertErr } = await supabase.from('blog_post_status').upsert(
            {
              account_id: acc.id,
              post_url: post.result_url,
              post_no: postNo,
              title: post.title,
              checked_at: checkedAt,
              status,
              chars,
              img_count: imgCount,
              ext_link_count: extLinkCount,
              miss_reason: missReason,
              published_at: post.completed_at ?? post.scheduled_at ?? post.created_at,
            },
            { onConflict: 'account_id,post_no' },
          );
          if (upsertErr) throw new Error(`blog_post_status 저장 실패: ${upsertErr.message}`);
          scannedPosts += 1;
          donePosts += 1;
          setScanProgress(donePosts, totalPosts);
        }

        scannedAccounts += 1;
        await logOperation({
          level: 'info',
          message: `[blog-check] ${acc.name} — 포스트 ${postRows.length}건 · 지수 ${idxScore ?? '—'}`,
          account_id: acc.id,
        });
      }
    });

    scanState.lastCompletedAt = new Date().toISOString();
    return { scannedAccounts, scannedPosts };
  } catch (err) {
    scanState.lastError = (err as Error).message;
    throw err;
  } finally {
    scanState.running = false;
    scanState.accountId = undefined;
    scanState.startedAt = null;
    setScanProgress(0, 0);
  }
}

/** UI 즉시 스캔 — BullMQ 대기 없이 동기 실행 */
export async function triggerBlogCheckScan(accountId?: string) {
  if (scanState.running) throw new Error('SCAN_ALREADY_RUNNING');
  const result = await runBlogCheckScan(accountId);
  return { ok: true as const, accountId, ...result };
}

export async function enqueueBlogCheckScan(accountId?: string): Promise<{ queued: true; accountId?: string }> {
  if (scanState.running) throw new Error('SCAN_ALREADY_RUNNING');

  await enqueueJob({
    type: 'blog_check',
    payload: { accountId: accountId ?? null },
  });

  return { queued: true, accountId };
}

export async function buildBlogCheckAccountsResponse(allowedWorkspaces: string[]) {
  const accounts = sortBlogCheckAccounts(
    (await listActivePostingAccounts()).filter((a) => allowedWorkspaces.includes(a.workspace)),
  );

  const result = [];
  for (const acc of accounts) {
    const blogId = extractBlogIdFromUrl(acc.blog_url, acc.naver_id) ?? acc.naver_id;
    const { data: statusRows } = await supabase
      .from('blog_post_status')
      .select('status, ext_link_count')
      .eq('account_id', acc.id);

    const rows = statusRows ?? [];
    const posts = rows.length;
    const miss = rows.filter((r) => r.status === 'miss').length;
    const ok = rows.filter((r) => r.status === 'ok').length;
    const ext = rows.filter((r) => (r.ext_link_count ?? 0) > 0).length;

    const { data: blogAcc } = await supabase
      .from('blog_accounts')
      .select('idx_score, checked_at')
      .eq('account_id', acc.id)
      .maybeSingle();

    const idx = Number(blogAcc?.idx_score ?? acc.blog_index ?? 0);
    const trend = await buildSevenDayMissTrend(acc.id);
    const session = await sessionLabel(acc.id, acc.health_score);

    result.push({
      id: acc.id,
      label: acc.name || acc.slot_label || acc.naver_id,
      svc: WS_LABEL[acc.workspace] ?? acc.workspace,
      url: blogId,
      idx,
      posts,
      ok,
      miss,
      ext,
      pattern: missRatePattern(miss, posts),
      session,
      trend,
    });
  }

  const { data: latestBlogAcc } = await supabase
    .from('blog_accounts')
    .select('checked_at')
    .order('checked_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return {
    accounts: result,
    lastScanAt: scanState.lastCompletedAt ?? latestBlogAcc?.checked_at ?? null,
    scanning: scanState.running,
    scanProgress: scanState.progress,
    lastScanError: scanState.lastError,
  };
}

export async function buildBlogCheckPostsResponse(accountId: string) {
  const { data: rows, error } = await supabase
    .from('blog_post_status')
    .select('*')
    .eq('account_id', accountId)
    .order('published_at', { ascending: false })
    .limit(60);

  if (error) throw new Error(error.message);

  return {
    posts: (rows ?? []).map((r) => ({
      date: formatPostDate(r.published_at as string | null),
      title: r.title ?? '—',
      chars: r.chars ?? 0,
      img: r.img_count ?? 0,
      ext: r.ext_link_count ?? 0,
      status: r.status as 'ok' | 'miss',
      missReason: r.miss_reason as string | null,
      postUrl: r.post_url as string,
    })),
  };
}

let lastScheduledKey = '';

export function startBlogCheckScheduler(): void {
  const tick = () => {
    const { hour, minute } = getKstClock();
    if (hour !== 9 || minute !== 0) return;
    const key = formatKstDateKey();
    if (lastScheduledKey === key) return;
    lastScheduledKey = key;
    enqueueBlogCheckScan().catch((err) => console.error('[blog-check-scheduler]', err));
  };

  setInterval(tick, 30_000);
  tick();
}

export async function executeBlogCheckJob(payload: { accountId?: string | null }) {
  return runBlogCheckScan(payload.accountId ?? undefined);
}
