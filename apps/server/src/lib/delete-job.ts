import { supabase } from '../middleware/auth.js';
import { removeBullJob } from './job-scheduler.js';

const VIDEO_JOB_FK_COLS = ['blog_job_id', 'threads_job_id', 'twitter_job_id'] as const;

/** huma_logs·video_queue FK 정리 후 job 삭제 */
export async function deleteJobById(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: existing, error: selectErr } = await supabase
    .from('huma_jobs')
    .select('id, bull_job_id')
    .eq('id', id)
    .maybeSingle();

  if (selectErr) return { ok: false, error: selectErr.message };
  if (!existing) return { ok: false, error: '작업 없음' };

  const { error: vqRowErr } = await supabase.from('huma_video_queue').delete().eq('job_id', id);
  if (vqRowErr) return { ok: false, error: vqRowErr.message };

  for (const col of VIDEO_JOB_FK_COLS) {
    const { error } = await supabase.from('huma_video_queue').update({ [col]: null }).eq(col, id);
    if (error) return { ok: false, error: error.message };
  }

  const { error: logsErr } = await supabase.from('huma_logs').delete().eq('job_id', id);
  if (logsErr) return { ok: false, error: logsErr.message };

  await removeBullJob(existing.bull_job_id);

  const { error: jobErr } = await supabase.from('huma_jobs').delete().eq('id', id);
  if (jobErr) return { ok: false, error: jobErr.message };

  return { ok: true };
}

export async function deleteJobsByIds(ids: string[]): Promise<{ deleted: number; failed: number; errors: string[] }> {
  const unique = [...new Set(ids.filter(Boolean))];
  let deleted = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const id of unique) {
    const result = await deleteJobById(id);
    if (result.ok) {
      deleted += 1;
    } else {
      failed += 1;
      errors.push(result.error);
    }
  }

  return { deleted, failed, errors: [...new Set(errors)] };
}
