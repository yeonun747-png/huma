import { supabase } from '../middleware/auth.js';

const VIDEO_JOB_FK_COLS = ['blog_job_id', 'threads_job_id', 'twitter_job_id'] as const;

/** huma_jobs·huma_logs·카페 기록 등 FK 정리 후 계정 삭제 */
export async function deleteAccountById(accountId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: jobs, error: jobsSelectErr } = await supabase
    .from('huma_jobs')
    .select('id')
    .eq('account_id', accountId);
  if (jobsSelectErr) return { ok: false, error: jobsSelectErr.message };

  const jobIds = (jobs ?? []).map((j) => j.id as string);

  if (jobIds.length > 0) {
    const { error: vqJobErr } = await supabase.from('huma_video_queue').delete().in('job_id', jobIds);
    if (vqJobErr) return { ok: false, error: vqJobErr.message };

    for (const col of VIDEO_JOB_FK_COLS) {
      const { error } = await supabase.from('huma_video_queue').update({ [col]: null }).in(col, jobIds);
      if (error) return { ok: false, error: error.message };
    }

    const { error: logsJobErr } = await supabase.from('huma_logs').delete().in('job_id', jobIds);
    if (logsJobErr) return { ok: false, error: logsJobErr.message };

    const { error: jobsDelErr } = await supabase.from('huma_jobs').delete().in('id', jobIds);
    if (jobsDelErr) return { ok: false, error: jobsDelErr.message };
  }

  const { error: logsAcctErr } = await supabase.from('huma_logs').delete().eq('account_id', accountId);
  if (logsAcctErr) return { ok: false, error: logsAcctErr.message };

  const { error: cafeErr } = await supabase
    .from('huma_cafe_viral_posts')
    .update({ account_id: null })
    .eq('account_id', accountId);
  if (cafeErr) return { ok: false, error: cafeErr.message };

  const { error: acctErr } = await supabase.from('huma_accounts').delete().eq('id', accountId);
  if (acctErr) return { ok: false, error: acctErr.message };

  return { ok: true };
}
