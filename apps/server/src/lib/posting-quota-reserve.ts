import { supabase } from '../middleware/auth.js';
import { formatKstDateKey, getDailyPostingTarget } from './posting-daily-target.js';
import { getEffectiveDailyLimit } from './human-engine-policy.js';

async function loadAccountWarmupDay(accountId: string): Promise<number> {
  const { data } = await supabase
    .from('huma_accounts')
    .select('warmup_day')
    .eq('id', accountId.trim())
    .maybeSingle();
  return (data?.warmup_day as number | undefined) ?? 0;
}

/** content_full insert 직전 원자적 슬롯 예약 — 실패 시 false */
export async function reservePostingQuotaSlot(accountId: string): Promise<boolean> {
  const key = accountId.trim();
  if (!key) return false;

  const kstDate = formatKstDateKey();
  const warmupDay = await loadAccountWarmupDay(key);
  const targetInfo = getDailyPostingTarget(key, new Date(), { warmupDay });
  const hardCap = await getEffectiveDailyLimit('post_blog');

  const { data, error } = await supabase.rpc('reserve_posting_quota_slot', {
    p_account_id: key,
    p_kst_date: kstDate,
    p_daily_target: targetInfo.target,
    p_hard_cap: hardCap,
  });

  if (error) throw new Error(`포스팅 슬롯 예약 실패: ${error.message}`);
  return data === true;
}

/** insert 실패·성공 후 예약 해제 (성공 시 in-flight job이 쿼터를 대체) */
export async function releasePostingQuotaSlot(accountId: string): Promise<void> {
  const key = accountId.trim();
  if (!key) return;

  const { error } = await supabase.rpc('release_posting_quota_slot', {
    p_account_id: key,
    p_kst_date: formatKstDateKey(),
  });

  if (error) throw new Error(`포스팅 슬롯 해제 실패: ${error.message}`);
}

/** 등록 시 예약 — 실패하면 기존 assert와 동일한 메시지 */
export async function assertAndReservePostingQuota(workspace: string, accountId: string): Promise<void> {
  const ok = await reservePostingQuotaSlot(accountId);
  if (ok) return;

  const { getAutoPublishStatus } = await import('./posting-daily-status.js');
  const status = await getAutoPublishStatus(workspace, accountId);
  throw new Error(status.block_message ?? '오늘 발행 한도에 도달했습니다');
}

export async function getPostingReservedToday(accountId: string): Promise<number> {
  const key = accountId.trim();
  if (!key) return 0;

  const kstDate = formatKstDateKey();
  const { data, error } = await supabase
    .from('huma_accounts')
    .select('posting_reserved_today, posting_reserved_kst_date')
    .eq('id', key)
    .maybeSingle();

  if (error) throw new Error(`예약 슬롯 조회 실패: ${error.message}`);
  if (data?.posting_reserved_kst_date !== kstDate) return 0;
  return (data?.posting_reserved_today as number | undefined) ?? 0;
}
