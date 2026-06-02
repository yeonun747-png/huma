import { supabase } from '../middleware/auth.js';

const WARMUP_MANUAL_CRANK_MAX_DAY = 30;

export function parseSocialCrankPayload(content?: string | null): Record<string, unknown> {
  if (!content?.trim()) return {};
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    if (parsed && typeof parsed === 'object') return parsed;
  } catch {
    /* plain text */
  }
  return {};
}

/** 워밍업 30일 전 수동 social_crank 큐 등록 차단 (스케줄러 scheduledCrank는 허용) */
export async function assertManualSocialCrankAllowed(
  accountId: string,
  content?: string | null,
): Promise<void> {
  const payload = parseSocialCrankPayload(content);
  if (payload.scheduledCrank === true) return;

  const { data: account } = await supabase
    .from('huma_accounts')
    .select('warmup_day, account_type, name')
    .eq('id', accountId)
    .single();

  if (!account || account.account_type !== 'crank') return;

  const warmupDay = account.warmup_day ?? 0;
  if (warmupDay >= WARMUP_MANUAL_CRANK_MAX_DAY) return;

  throw new Error(
    `워밍업 ${warmupDay}일차 계정(${account.name})은 수동 C-Rank 큐 등록이 제한됩니다. ` +
      `스케줄러 자동 큐를 사용하거나 워밍업 ${WARMUP_MANUAL_CRANK_MAX_DAY}일 이후에 시도하세요.`,
  );
}
