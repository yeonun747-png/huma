import { supabase } from '../middleware/auth.js';
import { SHARED_WORKSPACE_LIMITS } from './limits.js';

export async function checkSharedWorkspaceLimit(workspace: string, jobType: string) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (const group of SHARED_WORKSPACE_LIMITS) {
    if (!group.jobTypes.includes(jobType)) continue;
    if (!group.workspaces.includes(workspace as (typeof group.workspaces)[number])) continue;

    const { count } = await supabase
      .from('huma_jobs')
      .select('*', { count: 'exact', head: true })
      .in('workspace', [...group.workspaces])
      .eq('job_type', jobType)
      .eq('status', 'completed')
      .gte('completed_at', today.toISOString());

    if ((count ?? 0) >= group.limit) {
      throw new Error('SHARED_DAILY_LIMIT');
    }
  }
}
