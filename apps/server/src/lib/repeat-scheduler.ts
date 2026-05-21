import { supabase } from '../middleware/auth.js';
import { enqueueHumaJob, type JobRecord } from './job-scheduler.js';

/** v3.4 반복 예약: 작업 완료 시 다음 회차 huma_jobs 생성 */
export async function scheduleRepeatIfNeeded(completedJob: JobRecord) {
  const rule = completedJob.repeat_rule;
  if (!rule || rule === 'custom') return;

  const base = completedJob.scheduled_at ? new Date(completedJob.scheduled_at) : new Date();
  const next = nextOccurrence(base, rule);
  if (!next) return;

  const { data, error } = await supabase
    .from('huma_jobs')
    .insert({
      workspace: completedJob.workspace,
      account_id: completedJob.account_id,
      platform_account_id: completedJob.platform_account_id,
      job_type: completedJob.job_type,
      title: completedJob.title,
      content: completedJob.content,
      image_urls: completedJob.image_urls,
      link_url: completedJob.link_url,
      hashtags: completedJob.hashtags,
      platform: completedJob.platform,
      scheduled_at: next.toISOString(),
      repeat_rule: completedJob.repeat_rule,
      status: 'scheduled',
      retry_count: 0,
    })
    .select()
    .single();

  if (error || !data) return;
  await enqueueHumaJob(data as JobRecord);
}

function nextOccurrence(from: Date, rule: string): Date | null {
  const next = new Date(from);
  if (rule === 'daily') {
    next.setDate(next.getDate() + 1);
    return next;
  }
  if (rule === 'weekly-mwf') {
    return nextWeekday(next, [1, 3, 5]);
  }
  if (rule === 'weekly-tuth') {
    return nextWeekday(next, [2, 4]);
  }
  return null;
}

function nextWeekday(from: Date, allowed: number[]): Date {
  const d = new Date(from);
  for (let i = 0; i < 14; i++) {
    d.setDate(d.getDate() + 1);
    if (allowed.includes(d.getDay())) return d;
  }
  d.setDate(d.getDate() + 7);
  return d;
}
