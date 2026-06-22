import { supabase } from '../middleware/auth.js';
import { filterAccountsWithoutLayer4Rest, layer4RestSupabaseOr } from './account-guards.js';
import { postingSlotByWorkspace } from './dongle-slots.js';
import { YEONUN_POSTING_PORTS } from './posting-proxy.js';
import { redisConnection } from '../modules/queue/producer.js';

export type PostingAccountPick = {
  id: string;
  persona?: Record<string, unknown>;
  label?: string;
};

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

export function formatPostingAccountLabel(
  account: { name?: string | null; slot_label?: string | null } | null | undefined,
): string | null {
  const slot = account?.slot_label?.trim();
  if (slot) return slot;
  const name = account?.name?.trim();
  return name || null;
}

/** 발행 모니터 — 배정된 계정 또는 순환 대기(미배정) 계정 표시명 */
export async function resolvePostingAccountLabelForMonitor(
  workspace: string,
  accountId?: string | null,
): Promise<string> {
  if (accountId) {
    const { data } = await supabase
      .from('huma_accounts')
      .select('name, slot_label')
      .eq('id', accountId)
      .maybeSingle();
    return formatPostingAccountLabel(data) ?? '계정';
  }

  const picked = await pickPostingAccount(workspace, { advance: false });
  return picked?.label ?? '계정';
}

export function postingAccountLabelFromJob(job: {
  workspace?: string | null;
  job_type?: string | null;
  huma_accounts?: { name?: string | null; slot_label?: string | null } | null;
}): string | null {
  if (job.workspace !== 'yeonun') return null;
  if (job.job_type !== 'content_full' && job.job_type !== 'post_blog') return null;
  return formatPostingAccountLabel(job.huma_accounts);
}

export function attachPostingAccountLabels<T extends Record<string, unknown>>(
  jobs: T[],
): Array<T & { posting_account_label?: string }> {
  return jobs.map((job) => {
    const label = postingAccountLabelFromJob(
      job as {
        workspace?: string | null;
        job_type?: string | null;
        huma_accounts?: { name?: string | null; slot_label?: string | null } | null;
      },
    );
    return label ? { ...job, posting_account_label: label } : job;
  });
}

export async function loadPostingAccountById(accountId: string): Promise<PostingAccountPick | null> {
  const { data } = await supabase
    .from('huma_accounts')
    .select('id, persona, name, slot_label')
    .eq('id', accountId)
    .eq('account_type', 'posting')
    .maybeSingle();
  if (!data?.id) return null;
  return {
    id: data.id as string,
    persona: data.persona as Record<string, unknown> | undefined,
    label: formatPostingAccountLabel(data) ?? undefined,
  };
}

/** workspace·활성·연운 proxy_port 검증 */
export async function loadPostingAccountForWorkspace(
  accountId: string,
  workspace: string,
): Promise<PostingAccountPick | null> {
  if (!postingSlotByWorkspace(workspace)) return null;

  let query = supabase
    .from('huma_accounts')
    .select('id, persona, name, slot_label, proxy_port, layer4_rest_until')
    .eq('id', accountId.trim())
    .eq('workspace', workspace)
    .eq('account_type', 'posting')
    .eq('is_active', true)
    .or(layer4RestSupabaseOr());

  if (workspace === 'yeonun') {
    query = query.in('proxy_port', [...YEONUN_POSTING_PORTS]);
  }

  const { data } = await query.maybeSingle();
  if (!data?.id) return null;

  const active = filterAccountsWithoutLayer4Rest([data]);
  if (!active.length) return null;

  return {
    id: data.id as string,
    persona: data.persona as Record<string, unknown> | undefined,
    label: formatPostingAccountLabel(data) ?? undefined,
  };
}

/** 포스팅 큐 UI — workspace 활성 계정 전체 (연운1~3 순) */
export async function listPostingAccounts(workspace: string): Promise<PostingAccountPick[]> {
  if (!postingSlotByWorkspace(workspace)) return [];

  let query = supabase
    .from('huma_accounts')
    .select('id, persona, proxy_port, layer4_rest_until, name, slot_label')
    .eq('workspace', workspace)
    .eq('account_type', 'posting')
    .eq('is_active', true)
    .or(layer4RestSupabaseOr());

  if (workspace === 'yeonun') {
    query = query.in('proxy_port', [...YEONUN_POSTING_PORTS]);
  }

  const { data: rows } = await query.order('proxy_port', { ascending: true });
  return filterAccountsWithoutLayer4Rest(rows ?? []).map((account) => ({
    id: account.id as string,
    persona: account.persona as Record<string, unknown> | undefined,
    label: formatPostingAccountLabel(account) ?? undefined,
  }));
}

/** 수동 지정 account_id 또는 순환 pick */
export async function resolvePostingAccount(
  workspace: string,
  accountId?: string | null,
  options?: { advance?: boolean },
): Promise<PostingAccountPick | null> {
  if (accountId?.trim()) {
    return loadPostingAccountForWorkspace(accountId.trim(), workspace);
  }
  return pickPostingAccount(workspace, options);
}

/** content_full 부모 job에 이미 account_id가 있으면 재사용 — 순환 이중 소비 방지 */
export async function resolvePostingAccountForOrchestrator(
  workspace: string,
  parentJobId?: string,
): Promise<PostingAccountPick | null> {
  if (parentJobId) {
    const { data: parent } = await supabase
      .from('huma_jobs')
      .select('account_id')
      .eq('id', parentJobId)
      .maybeSingle();
    if (parent?.account_id) {
      const loaded = await loadPostingAccountById(parent.account_id as string);
      if (loaded) return loaded;
    }
  }

  const picked = await pickPostingAccount(workspace);
  if (parentJobId && picked?.id) {
    await supabase.from('huma_jobs').update({ account_id: picked.id }).eq('id', parentJobId);
  }
  return picked;
}

/** 작업 배정용 — 연운1~3 등 동일 workspace 복수 포스팅 계정을 proxy_port 순으로 순환 */
export async function pickPostingAccount(
  workspace: string,
  options?: { advance?: boolean },
): Promise<PostingAccountPick | null> {
  if (!postingSlotByWorkspace(workspace)) return null;

  let query = supabase
    .from('huma_accounts')
    .select('id, persona, proxy_port, layer4_rest_until, name, slot_label')
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
      label: formatPostingAccountLabel(account) ?? undefined,
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
    label: formatPostingAccountLabel(picked) ?? undefined,
  };
}
