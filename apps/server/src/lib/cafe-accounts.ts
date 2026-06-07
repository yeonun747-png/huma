import { supabase } from '../middleware/auth.js';
import {
  filterAccountsWithoutLayer4Rest,
  isLayer4RestActive,
  layer4RestSupabaseOr,
} from './account-guards.js';

/** v3.9: 카페 새글 — 운영(관리) 계정만 (posting 또는 cafe 타입) */
export async function assertCafeNewPostAccount(accountId: string): Promise<void> {
  const { data: account } = await supabase
    .from('huma_accounts')
    .select('account_type, is_active, layer4_rest_until')
    .eq('id', accountId)
    .single();

  if (!account?.is_active) throw new Error('CAFE_ADMIN_INACTIVE');
  if (isLayer4RestActive(account.layer4_rest_until)) throw new Error('LAYER4_REST');
  if (!['posting', 'cafe'].includes(account.account_type ?? '')) {
    throw new Error('CAFE_NEW_POST_REQUIRES_ADMIN_ACCOUNT');
  }
}

/** v3.9: 카페 답글 — C-Rank 풀에서 부하 낮은 계정 선택 */
export async function pickCafeReplyCrankAccount(): Promise<string | null> {
  const { data: accounts } = await supabase
    .from('huma_accounts')
    .select('id, crank_count_today, warmup_day, layer4_rest_until')
    .eq('account_type', 'crank')
    .eq('is_active', true)
    .or(layer4RestSupabaseOr())
    .order('crank_count_today', { ascending: true })
    .limit(20);

  if (!accounts?.length) return null;

  const rested = filterAccountsWithoutLayer4Rest(accounts);

  const eligible = rested.filter((a) => {
    const warmup = a.warmup_day ?? 0;
    const cap = warmup <= 7 ? 2 : 30;
    return (a.crank_count_today ?? 0) < cap;
  });

  return eligible[0]?.id ?? null;
}

/** 카페 키워드 스캔 — crank → cafe 순 활성 계정 (posting 제외) */
export async function pickCafeScanAccount(): Promise<string | null> {
  for (const accountType of ['crank', 'cafe'] as const) {
    const { data } = await supabase
      .from('huma_accounts')
      .select('id, layer4_rest_until')
      .eq('account_type', accountType)
      .eq('is_active', true)
      .or(layer4RestSupabaseOr())
      .order('created_at', { ascending: true })
      .limit(5);

    const picked = filterAccountsWithoutLayer4Rest(data ?? [])[0];
    if (picked?.id) return picked.id;
  }
  return null;
}

export async function assertCafeReplyAccount(accountId: string): Promise<void> {
  const { data: account } = await supabase
    .from('huma_accounts')
    .select('account_type, is_active, layer4_rest_until')
    .eq('id', accountId)
    .single();

  if (!account?.is_active) throw new Error('CRANK_ACCOUNT_INACTIVE');
  if (isLayer4RestActive(account.layer4_rest_until)) throw new Error('LAYER4_REST');
  if (account.account_type !== 'crank') {
    throw new Error('CAFE_REPLY_REQUIRES_CRANK_ACCOUNT');
  }
}
