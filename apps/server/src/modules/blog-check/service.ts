import { supabase } from '../../middleware/auth.js';
import { formatKstDateKey, getKstClock } from '../../lib/crank-schedule-config.js';
import { logOperation } from '../../lib/log-emitter.js';
import { sleep } from '../../lib/utils.js';
import { enqueueJob } from '../queue/producer.js';
import { extractBlogIdFromUrl, extractPostNoFromUrl } from './blog-url.js';
import { computeBlogIndexScore, scrapeBlogStats } from './index-score.js';
import { inferMissReason, type MissReason } from './miss-reason.js';
import { notifyBlogCheckCaptcha, notifyBlogCheckIndexParseFailed } from './notify.js';
import {
  acquireBlogCheckScanLock,
  isBlogCheckScanLocked,
  releaseBlogCheckScanLock,
} from './scan-lock.js';
import {
  BlogCheckCaptchaError,
  checkPostIndexed,
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

const POST_LIMIT = 30;

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

function mapSessionStatus(raw: string | null | undefined): '정상' | '오류' {
  return raw === 'active' ? '정상' : '오류';
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
  let q = supabase
    .from('huma_accounts')
    .select('id, name, naver_id, blog_url, workspace, slot_label, proxy_port, session_status')
    .eq('account_type', 'posting')
    .eq('is_active', true);

  if (accountId) q = q.eq('id', accountId);

  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return sortAccounts((data ?? []) as AccountRow[]);
}

/** published_at 내림차순 최근 30건 */
async function fetchRecentPosts(accountId: string): Promise<PostRow[]> {
  const { data, error } = await supabase
    .from('posts')
    .select('*')
    .eq('account_id', accountId)
    .order('published_at', { ascending: false })
    .limit(POST_LIMIT);

  if (error) throw new Error(error.message);
  return (data ?? []) as PostRow[];
}

async function fetchLatestStatusByPostNo(accountId: string): Promise<Map<string, StatusRow>> {
  const { data, error } = await supabase
    .from('blog_post_status')
    .select('post_no, status, scanned_at')
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
      const label = acc.name || acc.slot_label || acc.naver_id;
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

      for (let i = 0; i < posts.length && !accountAborted; i++) {
        const post = posts[i];
        const postNo = post.post_no ?? extractPostNoFromUrl(post.post_url);
        if (!postNo) continue;

        try {
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

          if (insErr) throw new Error(`blog_post_status insert 실패: ${insErr.message}`);
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
      ok_count: okCount,
      miss_count: missCount,
      miss_rate: missRate,
      trend,
      trend_direction: trendDirection(trend),
      session_status: mapSessionStatus(acc.session_status),
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
