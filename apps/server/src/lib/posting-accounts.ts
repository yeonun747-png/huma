import { supabase } from '../middleware/auth.js';
import { filterAccountsWithoutLayer4Rest, layer4RestSupabaseOr } from './account-guards.js';
import { postingSlotByWorkspace } from './dongle-slots.js';
import { YEONUN_POSTING_PORTS } from './posting-proxy.js';
import { redisConnection } from '../modules/queue/producer.js';

export type PostingAccountPick = { id: string; persona?: Record<string, unknown> };

function postingRoundRobinKey(workspace: string): string {
  return `posting_account_rr:${workspace}`;
}

/** proxy_port 오름차순 [연운1, 연운2, 연운3] — 첫 배정을 연운2(index 1)부터 */
const YEONUN_RR_START_INDEX = 1;

function roundRobinIndex(workspace: string, seq: number, advance: boolean, poolSize: number): number {
  const base = advance ? seq - 1 : seq;
  const offset = workspace === 'yeonun' ? YEONUN_RR_START_INDEX : 0;
  return (base + offset) % poolSize;
}

/** 작업 배정용 — 연운1~3 등 동일 workspace 복수 포스팅 계정을 proxy_port 순으로 순환 */
export async function pickPostingAccount(
  workspace: string,
  options?: { advance?: boolean },
): Promise<PostingAccountPick | null> {
  if (!postingSlotByWorkspace(workspace)) return null;

  let query = supabase
    .from('huma_accounts')
    .select('id, persona, proxy_port, layer4_rest_until')
    .eq('workspace', workspace)
    .eq('account_type', 'posting')
    .eq('is_active', true)
    .or(layer4RestSupabaseOr());

  if (workspace === 'yeonun') {
    query = query.in('proxy_port', [...YEONUN_POSTING_PORTS]);
  }

  const { data: rows } = await query.order('proxy_port', { ascending: true });
  const accounts = filterAccountsWithoutLayer4Rest(rows ?? []);
  if (!accounts.length) return null;

  if (accounts.length === 1) {
    const account = accounts[0]!;
    return {
      id: account.id as string,
      persona: account.persona as Record<string, unknown> | undefined,
    };
  }

  const advance = options?.advance !== false;
  const seq = advance
    ? await redisConnection.incr(postingRoundRobinKey(workspace))
    : Number((await redisConnection.get(postingRoundRobinKey(workspace))) ?? '0');
  const picked = accounts[roundRobinIndex(workspace, seq, advance, accounts.length)]!;
  return {
    id: picked.id as string,
    persona: picked.persona as Record<string, unknown> | undefined,
  };
}
