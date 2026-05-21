import { supabase } from '../middleware/auth.js';

/** v3.9: 카페 새글 — 운영(관리) 계정만 (posting 또는 cafe 타입) */
export async function assertCafeNewPostAccount(accountId: string): Promise<void> {
  const { data: account } = await supabase
    .from('huma_accounts')
    .select('account_type, is_active')
    .eq('id', accountId)
    .single();

  if (!account?.is_active) throw new Error('CAFE_ADMIN_INACTIVE');
  if (!['posting', 'cafe'].includes(account.account_type ?? '')) {
    throw new Error('CAFE_NEW_POST_REQUIRES_ADMIN_ACCOUNT');
  }
}

/** v3.9: 카페 답글 — C-Rank 풀에서 부하 낮은 계정 선택 */
export async function pickCafeReplyCrankAccount(): Promise<string | null> {
  const { data: accounts } = await supabase
    .from('huma_accounts')
    .select('id, crank_count_today, warmup_day')
    .eq('account_type', 'crank')
    .eq('is_active', true)
    .order('crank_count_today', { ascending: true })
    .limit(20);

  if (!accounts?.length) return null;

  // 워밍업 0~7일: C-Rank 2건/일 (기획서 ⑱)
  const eligible = accounts.filter((a) => {
    const warmup = a.warmup_day ?? 0;
    const cap = warmup <= 7 ? 2 : 30;
    return (a.crank_count_today ?? 0) < cap;
  });

  return (eligible[0] ?? accounts[0])?.id ?? null;
}

export async function assertCafeReplyAccount(accountId: string): Promise<void> {
  const { data: account } = await supabase
    .from('huma_accounts')
    .select('account_type, is_active')
    .eq('id', accountId)
    .single();

  if (!account?.is_active) throw new Error('CRANK_ACCOUNT_INACTIVE');
  if (account.account_type !== 'crank') {
    throw new Error('CAFE_REPLY_REQUIRES_CRANK_ACCOUNT');
  }
}
