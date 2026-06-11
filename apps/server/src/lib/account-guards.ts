import { supabase } from '../middleware/auth.js';
import {
  isNightBanActive,
  passesActiveHoursGate,
} from './human-engine-policy.js';
import { getSystemPaused } from './system-pause.js';

export function isLayer4RestActive(restUntil: string | null | undefined): boolean {
  return Boolean(restUntil && new Date(restUntil) > new Date());
}

export async function assertSystemNotPaused(): Promise<void> {
  if (getSystemPaused()) throw new Error('SYSTEM_PAUSED');
}

export async function assertTemporalNaverGates(): Promise<void> {
  if (await isNightBanActive()) throw new Error('NIGHT_BAN');
  if (!(await passesActiveHoursGate())) throw new Error('ACTIVE_HOURS_BLOCKED');
}

export async function assertAccountRunnable(accountId: string): Promise<void> {
  const { data } = await supabase
    .from('huma_accounts')
    .select('is_active, layer4_rest_until')
    .eq('id', accountId)
    .maybeSingle();

  if (!data) throw new Error('계정 없음');
  if (data.is_active === false) throw new Error('ACCOUNT_INACTIVE');
  if (isLayer4RestActive(data.layer4_rest_until)) throw new Error('LAYER4_REST');
}

export async function assertNaverAutomationAllowed(accountId: string): Promise<void> {
  await assertSystemNotPaused();
  await assertTemporalNaverGates();
  await assertAccountRunnable(accountId);
}

export async function assertJobEnqueueAllowed(accountId?: string | null): Promise<void> {
  await assertSystemNotPaused();
  if (accountId) await assertAccountRunnable(accountId);
}

export function filterAccountsWithoutLayer4Rest<
  T extends { layer4_rest_until?: string | null },
>(accounts: T[]): T[] {
  return accounts.filter((a) => !isLayer4RestActive(a.layer4_rest_until));
}

export function layer4RestSupabaseOr(now = new Date().toISOString()): string {
  return `layer4_rest_until.is.null,layer4_rest_until.lte.${now}`;
}

const NAVER_ACCOUNT_JOB_TYPES = new Set([
  'post_blog',
  'social_crank',
  'cafe_new_post',
  'cafe_reply',
]);

export async function isHumaJobAdvanceRequested(humaJobId?: string | null): Promise<boolean> {
  if (!humaJobId) return false;
  const { data } = await supabase
    .from('huma_jobs')
    .select('advance_requested_at')
    .eq('id', humaJobId)
    .maybeSingle();
  return Boolean(data?.advance_requested_at);
}

export async function assertHumaJobRunnable(job: {
  job_type?: string;
  account_id?: string | null;
}): Promise<void> {
  await assertJobEnqueueAllowed(job.account_id);
  if (job.account_id && job.job_type && NAVER_ACCOUNT_JOB_TYPES.has(job.job_type)) {
    await assertTemporalNaverGates();
  }
}

/** 앞당기기 — 스케줄·야간·활동시간 게이트 우회, 계정·전체정지만 확인 */
export async function assertHumaJobAdvanceAllowed(job: {
  account_id?: string | null;
}): Promise<void> {
  await assertJobEnqueueAllowed(job.account_id);
}
