import { supabase } from '../middleware/auth.js';
import { extractBlogIdFromUrl, normalizeBlogPostUrl } from '../modules/blog-check/blog-url.js';
import { releaseStuckJobResources } from './abort-job.js';
import { logOperation } from './log-emitter.js';
import { finalizePostBlogJob } from './post-blog-job-complete.js';

export const RECONCILABLE_POST_BLOG_STATUSES = ['failed', 'running', 'awaiting_captcha'] as const;

export function normalizePostTitleForMatch(title: string): string {
  return title.replace(/\s+/g, ' ').trim().toLowerCase();
}

interface NaverListItem {
  logNo?: number | string;
  title?: string;
  titleWithInspectMessage?: string;
  addDate?: number | string;
}

/** 공개 블로그 API — Playwright/동글 없이 최근 글 목록 */
export async function fetchPublicNaverBlogPostList(
  blogId: string,
  limit = 25,
): Promise<Array<{ postUrl: string; title: string; publishedAt: string | null }>> {
  const id = blogId.trim();
  if (!id) return [];

  const apiUrl = `https://m.blog.naver.com/api/blogs/${encodeURIComponent(id)}/post-list?categoryNo=0&itemCount=${limit}&page=1`;
  const res = await fetch(apiUrl, {
    headers: {
      Accept: 'application/json',
      Referer: `https://m.blog.naver.com/${id}`,
      'User-Agent':
        'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
    },
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);

  if (!res?.ok) return [];

  const body = (await res.json().catch(() => null)) as {
    isSuccess?: boolean;
    result?: { items?: NaverListItem[] };
  } | null;

  if (!body?.isSuccess || !body.result?.items?.length) return [];

  return body.result.items
    .map((item) => {
      const postNo = String(item.logNo ?? '').trim();
      if (!postNo) return null;
      const title = (item.titleWithInspectMessage ?? item.title ?? '').trim();
      let publishedAt: string | null = null;
      if (item.addDate != null) {
        const ms = typeof item.addDate === 'number' ? item.addDate : Number(item.addDate);
        if (Number.isFinite(ms) && ms > 0) publishedAt = new Date(ms).toISOString();
      }
      return {
        postUrl: normalizeBlogPostUrl(id, postNo),
        title,
        publishedAt,
      };
    })
    .filter((x): x is { postUrl: string; title: string; publishedAt: string | null } => x != null);
}

function reconcileWindowStart(iso: string | null | undefined): number {
  if (!iso) return Date.now() - 6 * 60 * 60 * 1000;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return Date.now() - 6 * 60 * 60 * 1000;
  return t - 30 * 60 * 1000;
}

/** reconcile — job 시각 이후·현재 이전에 실제 발행된 글만 인정 */
export function isPublishedInReconcileWindow(
  publishedAt: string | null | undefined,
  sinceMs: number,
): boolean {
  if (!publishedAt?.trim()) return false;
  const at = new Date(publishedAt).getTime();
  if (!Number.isFinite(at)) return false;
  return at >= sinceMs && at <= Date.now() + 60_000;
}

/**
 * 워커 실패 직전 — 블로그에 동일 제목 글이 이미 올라갔으면 completed로 정정.
 * (동글 SOCKS 오류 등으로 completeJob 전에 failed 된 케이스)
 */
export async function tryReconcilePostBlogJobCompletion(jobId: string): Promise<string | null> {
  const { data: job } = await supabase
    .from('huma_jobs')
    .select('id, job_type, status, result_url, title, account_id, scheduled_at, started_at, created_at')
    .eq('id', jobId)
    .maybeSingle();

  if (!job || job.job_type !== 'post_blog') return null;
  if (job.status === 'completed' && job.result_url?.trim()) return job.result_url.trim();

  const expectedTitle = normalizePostTitleForMatch(String(job.title ?? ''));
  if (!expectedTitle || !job.account_id) return null;

  const sinceMs = reconcileWindowStart(
    (job.started_at as string | null) ?? (job.scheduled_at as string | null) ?? (job.created_at as string | null),
  );
  const createdMs = new Date(job.created_at as string).getTime();
  const windowStartMs = Number.isFinite(createdMs) ? Math.max(sinceMs, createdMs - 5 * 60_000) : sinceMs;

  const { data: account } = await supabase
    .from('huma_accounts')
    .select('blog_url, naver_id')
    .eq('id', job.account_id)
    .maybeSingle();

  const blogId = extractBlogIdFromUrl(account?.blog_url as string | null, account?.naver_id as string | null);
  if (!blogId) return null;

  const { data: dbPosts } = await supabase
    .from('posts')
    .select('post_url, title, published_at')
    .eq('account_id', job.account_id)
    .order('published_at', { ascending: false })
    .limit(30);

  for (const row of dbPosts ?? []) {
    if (normalizePostTitleForMatch(String(row.title ?? '')) !== expectedTitle) continue;
    if (!isPublishedInReconcileWindow(row.published_at as string | null, windowStartMs)) continue;
    const url = String(row.post_url ?? '').trim();
    if (!url) continue;
    const ok = await finalizePostBlogJob(jobId, url, {
      publishedAt: row.published_at as string,
      reconciledFromFailed: true,
    });
    if (ok) {
      await logOperation({
        level: 'info',
        message: `[post_blog] 블로그 발행 확인(posts) — ${job.status} → completed`,
        job_id: jobId,
        account_id: job.account_id as string,
      });
      return url;
    }
  }

  const livePosts = await fetchPublicNaverBlogPostList(blogId, 30);
  for (const post of livePosts) {
    if (normalizePostTitleForMatch(post.title) !== expectedTitle) continue;
    if (!isPublishedInReconcileWindow(post.publishedAt, windowStartMs)) continue;
    const ok = await finalizePostBlogJob(jobId, post.postUrl, {
      publishedAt: post.publishedAt,
      reconciledFromFailed: true,
    });
    if (ok) {
      await logOperation({
        level: 'info',
        message: `[post_blog] 블로그 발행 확인(네이버 API) — ${job.status} → completed`,
        job_id: jobId,
        account_id: job.account_id as string,
      });
      return post.postUrl;
    }
  }

  return null;
}

/** failed·LIVE·CAPTCHA — 네이버 발행 확인 후 completed (LIVE는 세션·락 해제) */
export async function reconcilePostBlogJobById(
  jobId: string,
): Promise<{ ok: true; result_url: string } | { ok: false; error: string; status: number }> {
  const { data: job, error } = await supabase
    .from('huma_jobs')
    .select('id, job_type, status, bull_job_id, account_id, title')
    .eq('id', jobId)
    .maybeSingle();

  if (error) return { ok: false, error: error.message, status: 500 };
  if (!job) return { ok: false, error: '작업 없음', status: 404 };
  if (job.job_type !== 'post_blog') {
    return { ok: false, error: 'post_blog 작업만 지원합니다', status: 400 };
  }
  if (!(RECONCILABLE_POST_BLOG_STATUSES as readonly string[]).includes(String(job.status))) {
    return {
      ok: false,
      error: 'failed·LIVE·CAPTCHA 대기 상태만 발행 확인할 수 있습니다',
      status: 400,
    };
  }

  const wasActive = job.status === 'running' || job.status === 'awaiting_captcha';
  const resultUrl = await tryReconcilePostBlogJobCompletion(jobId);
  if (!resultUrl) {
    return { ok: false, error: '블로그에서 일치하는 발행 글을 찾지 못했습니다', status: 404 };
  }

  if (wasActive) {
    await releaseStuckJobResources(job);
    await logOperation({
      level: 'info',
      message: `[post_blog] LIVE 발행 확인 — 세션·락 해제 후 completed (${resultUrl})`,
      job_id: jobId,
      account_id: job.account_id as string | undefined,
    });
  }

  return { ok: true, result_url: resultUrl };
}
