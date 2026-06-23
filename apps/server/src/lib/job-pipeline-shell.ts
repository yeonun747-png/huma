import { isContentFullPipelineShell } from '@huma/shared';

import { supabase } from '../middleware/auth.js';
import { normalizePostUrlKey } from '../modules/blog-check/blog-url.js';
import {
  isPublishedTodayKst,
  resolveJobPublishedAtIso,
} from './post-blog-publish-day.js';

export { isContentFullPipelineShell };

type PipelineJobRow = {
  job_type?: string | null;
  status?: string | null;
  result_url?: string | null;
  platform_schedule?: unknown;
  completed_at?: string | null;
  scheduled_at?: string | null;
  account_id?: string | null;
};

export function filterOutPipelineShells<T extends PipelineJobRow>(jobs: T[]): T[] {
  return jobs.filter((j) => !isContentFullPipelineShell(j));
}

export async function fetchVisibleCompletedJobs(
  workspace: string,
): Promise<PipelineJobRow[]> {
  const { data, error } = await supabase
    .from('huma_jobs')
    .select('job_type, status, result_url, platform_schedule, completed_at, scheduled_at, account_id')
    .eq('workspace', workspace)
    .eq('status', 'completed');

  if (error) return [];
  return filterOutPipelineShells(data ?? []);
}

/** non-dry completed content_full 건수 — total 보정용 */
export async function countContentFullPipelineShells(
  workspace: string | string[],
  options?: { completedSince?: string; completedUntil?: string },
): Promise<number> {
  let query = supabase
    .from('huma_jobs')
    .select('job_type, status, platform_schedule, completed_at')
    .eq('job_type', 'content_full')
    .eq('status', 'completed');

  if (Array.isArray(workspace)) {
    query = query.in('workspace', workspace);
  } else {
    query = query.eq('workspace', workspace);
  }

  if (options?.completedSince) {
    query = query.gte('completed_at', options.completedSince);
  }
  if (options?.completedUntil) {
    query = query.lte('completed_at', options.completedUntil);
  }

  const { data, error } = await query;
  if (error) return 0;
  return (data ?? []).filter((row) => isContentFullPipelineShell(row as PipelineJobRow)).length;
}

export async function computeVisibleQueueStats(
  workspace: string,
  todayStartIso: string,
): Promise<{ doneToday: number; doneAll: number }> {
  const visible = await fetchVisibleCompletedJobs(workspace);

  const postBlogRows = visible.filter(
    (j) => j.job_type === 'post_blog' && j.result_url?.trim() && j.account_id,
  );
  const postPublishedByUrl = new Map<string, string | null>();
  if (postBlogRows.length) {
    const accountIds = [...new Set(postBlogRows.map((j) => j.account_id as string))];
    const urlKeys = [
      ...new Set(
        postBlogRows
          .map((j) => j.result_url)
          .filter((u): u is string => Boolean(u?.trim()))
          .map(normalizePostUrlKey),
      ),
    ];
    const { data: postRows } = await supabase
      .from('posts')
      .select('account_id, post_url, published_at')
      .in('account_id', accountIds);
    for (const row of postRows ?? []) {
      const k = normalizePostUrlKey(String(row.post_url ?? ''));
      if (k && urlKeys.includes(k) && row.published_at) {
        postPublishedByUrl.set(k, row.published_at as string);
      }
    }
  }

  let doneToday = 0;
  for (const j of visible) {
    if (j.job_type === 'post_blog' && j.result_url?.trim()) {
      const publishedAt = resolveJobPublishedAtIso(j, postPublishedByUrl);
      if (isPublishedTodayKst(publishedAt)) doneToday += 1;
    } else if (j.completed_at && j.completed_at >= todayStartIso) {
      doneToday += 1;
    }
  }

  return { doneAll: visible.length, doneToday };
}
