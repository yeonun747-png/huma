import { isContentFullPipelineShell } from '@huma/shared';

import { supabase } from '../middleware/auth.js';

export { isContentFullPipelineShell };

type ShellRow = {
  job_type?: string | null;
  result_url?: string | null;
  platform_schedule?: unknown;
};

export function filterOutPipelineShells<T extends ShellRow>(jobs: T[]): T[] {
  return jobs.filter((j) => !isContentFullPipelineShell(j));
}

/** content_full 파이프라인 셸(completed·자식 job id 보유) 건수 — 집계 보정용 */
export async function countContentFullPipelineShells(
  workspace: string | string[],
  options?: { completedSince?: string; completedUntil?: string },
): Promise<number> {
  let query = supabase
    .from('huma_jobs')
    .select('job_type, result_url, platform_schedule, status')
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
  return (data ?? []).filter((row) => isContentFullPipelineShell(row as ShellRow)).length;
}
