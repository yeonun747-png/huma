import { isContentFullPipelineShell } from '@huma/shared';

import { supabase } from '../middleware/auth.js';

export { isContentFullPipelineShell };

type PipelineJobRow = {
  job_type?: string | null;
  status?: string | null;
  result_url?: string | null;
  platform_schedule?: unknown;
  completed_at?: string | null;
};

export function filterOutPipelineShells<T extends PipelineJobRow>(jobs: T[]): T[] {
  return jobs.filter((j) => !isContentFullPipelineShell(j));
}

export async function fetchVisibleCompletedJobs(
  workspace: string,
): Promise<PipelineJobRow[]> {
  const { data, error } = await supabase
    .from('huma_jobs')
    .select('job_type, status, result_url, platform_schedule, completed_at')
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
  return {
    doneAll: visible.length,
    doneToday: visible.filter((j) => j.completed_at && j.completed_at >= todayStartIso).length,
  };
}
