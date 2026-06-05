import type { Workspace } from '@huma/shared';
import { crankServiceLabelKo } from '@huma/shared';
import { supabase } from '../middleware/auth.js';
import { fetchPostingBlogUrls } from './crank-scheduler.js';

export type CrankSessionActivity = {
  url: string;
  type: string;
  at: string;
  title: string | null;
};

export type CrankJobSessionDetail = {
  crank_workspace: Workspace;
  service_label: string;
  crank_label: string | null;
  our_blog_targets: string[];
  our_activity: CrankSessionActivity[];
  other_activity: CrankSessionActivity[];
  session_started: boolean;
};

function normalizeBlogUrl(url: string): string {
  return url.toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');
}

export function isOurBlogUrl(visitUrl: string, ourUrls: string[]): boolean {
  const v = normalizeBlogUrl(visitUrl);
  return ourUrls.some((our) => {
    const o = normalizeBlogUrl(our);
    return v === o || v.startsWith(`${o}/`) || o.startsWith(`${v}/`);
  });
}

export async function getCrankJobSessionDetail(jobId: string): Promise<CrankJobSessionDetail | null> {
  const { data: job } = await supabase.from('huma_jobs').select('*').eq('id', jobId).single();
  if (!job || job.job_type !== 'social_crank') return null;

  let ws = (job.workspace ?? 'yeonun') as Workspace;
  let crankLabel: string | null = null;

  if (job.account_id) {
    const { data: acct } = await supabase
      .from('huma_accounts')
      .select('crank_label, crank_workspace')
      .eq('id', job.account_id)
      .maybeSingle();
    crankLabel = (acct?.crank_label as string | null) ?? null;
    if (acct?.crank_workspace) ws = acct.crank_workspace as Workspace;
  }

  const ourBlogTargets = await fetchPostingBlogUrls(ws);
  const ourActivity: CrankSessionActivity[] = [];
  const otherActivity: CrankSessionActivity[] = [];

  if (job.account_id && job.started_at) {
    let query = supabase
      .from('huma_logs')
      .select('created_at, result_url, metadata, message')
      .eq('account_id', job.account_id)
      .eq('platform', 'naver_crank')
      .gte('created_at', job.started_at)
      .order('created_at', { ascending: true });

    if (job.completed_at) {
      query = query.lte('created_at', job.completed_at);
    }

    const { data: logs } = await query;
    const seen = new Set<string>();

    for (const log of logs ?? []) {
      const url = log.result_url as string | null;
      if (!url) continue;
      const meta = (log.metadata as Record<string, unknown> | null) ?? {};
      const type =
        meta.crank_action === '방문' ||
        meta.crank_action === '공감' ||
        meta.crank_action === '댓글' ||
        meta.crank_action === '이웃'
          ? String(meta.crank_action)
          : '방문';
      const dedupeKey = `${url}|${type}|${log.created_at}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      const row: CrankSessionActivity = {
        url,
        type,
        at: log.created_at as string,
        title: typeof meta.target_title === 'string' ? meta.target_title : null,
      };
      if (isOurBlogUrl(url, ourBlogTargets)) ourActivity.push(row);
      else otherActivity.push(row);
    }
  }

  return {
    crank_workspace: ws,
    service_label: crankServiceLabelKo(ws),
    crank_label: crankLabel,
    our_blog_targets: ourBlogTargets,
    our_activity: ourActivity,
    other_activity: otherActivity,
    session_started: Boolean(job.started_at),
  };
}
