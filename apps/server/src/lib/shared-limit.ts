import { supabase } from '../middleware/auth.js';
import { SHARED_WORKSPACE_LIMITS } from './limits.js';

/** KST 오늘 자정의 UTC ISO — 서버 TZ가 UTC여도 일일 경계가 KST와 어긋나지 않게 */
function kstTodayStartIso(): string {
  const kstOffsetMs = 9 * 60 * 60 * 1000;
  const kstNow = new Date(Date.now() + kstOffsetMs);
  const kstMidnight = Date.UTC(
    kstNow.getUTCFullYear(),
    kstNow.getUTCMonth(),
    kstNow.getUTCDate(),
    0,
    0,
    0,
    0,
  );
  return new Date(kstMidnight - kstOffsetMs).toISOString();
}

export async function checkSharedWorkspaceLimit(workspace: string, jobType: string) {
  const todayIso = kstTodayStartIso();

  for (const group of SHARED_WORKSPACE_LIMITS) {
    if (!group.jobTypes.includes(jobType)) continue;
    if (!group.workspaces.includes(workspace as (typeof group.workspaces)[number])) continue;

    const { count } = await supabase
      .from('huma_jobs')
      .select('*', { count: 'exact', head: true })
      .in('workspace', [...group.workspaces])
      .eq('job_type', jobType)
      .eq('status', 'completed')
      .gte('completed_at', todayIso);

    if ((count ?? 0) >= group.limit) {
      throw new Error('SHARED_DAILY_LIMIT');
    }
  }
}
