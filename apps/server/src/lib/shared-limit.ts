import { supabase } from '../middleware/auth.js';
import { getEffectiveDailyLimit } from './human-engine-policy.js';
import { kstTodayStartIso } from './posting-daily-status.js';

/** post_blog — 계정별 안전 상한 (워크스페이스 합산 아님) */
export async function checkSharedWorkspaceLimit(
  workspace: string,
  jobType: string,
  accountId?: string | null,
) {
  if (jobType !== 'post_blog') return;

  const hardCap = await getEffectiveDailyLimit('post_blog');
  const todayIso = kstTodayStartIso();

  if (accountId?.trim()) {
    const { count } = await supabase
      .from('huma_jobs')
      .select('*', { count: 'exact', head: true })
      .eq('account_id', accountId.trim())
      .eq('job_type', 'post_blog')
      .eq('status', 'completed')
      .gte('completed_at', todayIso);

    if ((count ?? 0) >= hardCap) {
      throw new Error('SHARED_DAILY_LIMIT');
    }
    return;
  }

  const { count } = await supabase
    .from('huma_jobs')
    .select('*', { count: 'exact', head: true })
    .eq('workspace', workspace)
    .eq('job_type', 'post_blog')
    .eq('status', 'completed')
    .gte('completed_at', todayIso);

  if ((count ?? 0) >= hardCap) {
    throw new Error('SHARED_DAILY_LIMIT');
  }
}
