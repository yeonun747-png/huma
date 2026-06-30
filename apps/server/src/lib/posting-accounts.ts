import { supabase } from '../middleware/auth.js';
import { filterAccountsWithoutLayer4Rest, layer4RestSupabaseOr } from './account-guards.js';
import { POSTING_DONGLE_SLOTS, postingSlotByWorkspace } from './dongle-slots.js';
import { YEONUN_POSTING_PORTS } from './posting-proxy.js';
import { redisConnection } from '../modules/queue/producer.js';

export type PostingAccountPick = {
  id: string;
  persona?: Record<string, unknown>;
  label?: string;
  proxy_port?: number;
};

type PostingAccountRow = {
  id: string;
  persona?: unknown;
  proxy_port?: number | null;
  layer4_rest_until?: string | null;
  name?: string | null;
  slot_label?: string | null;
};

function postingPortRoundRobinKey(proxyPort: number): string {
  return `posting_account_rr:port:${proxyPort}`;
}

function postingDongleRoundRobinKey(workspace: string): string {
  return `posting_dongle_rr:${workspace}`;
}

function postingLockKey(port: number): string {
  return `modem_lock:posting:${port}`;
}

export function formatPostingAccountLabel(
  account: { name?: string | null; slot_label?: string | null } | null | undefined,
): string | null {
  const slot = account?.slot_label?.trim();
  if (slot) return slot;
  const name = account?.name?.trim();
  return name || null;
}

async function isPostingPortIdle(proxyPort: number): Promise<boolean> {
  const lock = await redisConnection.get(postingLockKey(proxyPort));
  return !lock;
}

function pickFromPool<T>(pool: T[], seq: number, advance: boolean): T {
  const index = advance ? (seq - 1) % pool.length : seq % pool.length;
  return pool[index]!;
}

function rowToPick(account: PostingAccountRow): PostingAccountPick {
  return {
    id: account.id as string,
    persona: account.persona as Record<string, unknown> | undefined,
    label: formatPostingAccountLabel(account) ?? undefined,
    proxy_port: account.proxy_port ?? undefined,
  };
}

async function loadActivePostingRows(workspace: string): Promise<PostingAccountRow[]> {
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

  const { data: rows } = await query.order('proxy_port', { ascending: true }).order('slot_label', {
    ascending: true,
  });
  return filterAccountsWithoutLayer4Rest(rows ?? []) as PostingAccountRow[];
}

async function pickAccountOnPort(
  accounts: PostingAccountRow[],
  proxyPort: number,
  advance: boolean,
): Promise<PostingAccountPick | null> {
  const onPort = accounts.filter((a) => a.proxy_port === proxyPort);
  if (!onPort.length) return null;
  if (onPort.length === 1) return rowToPick(onPort[0]!);

  const seq = advance
    ? await redisConnection.incr(postingPortRoundRobinKey(proxyPort))
    : Number((await redisConnection.get(postingPortRoundRobinKey(proxyPort))) ?? '0');
  return rowToPick(pickFromPool(onPort, seq, advance));
}

/** 유휴 동글 우선 → 동글 RR → 해당 동글 계정 RR */
async function pickPortForWorkspace(
  workspace: string,
  portsWithAccounts: number[],
  advance: boolean,
): Promise<number | null> {
  if (!portsWithAccounts.length) return null;

  const idlePorts: number[] = [];
  for (const port of portsWithAccounts) {
    if (await isPostingPortIdle(port)) idlePorts.push(port);
  }
  const pool = idlePorts.length ? idlePorts : portsWithAccounts;

  if (pool.length === 1) return pool[0]!;

  const seq = advance
    ? await redisConnection.incr(postingDongleRoundRobinKey(workspace))
    : Number((await redisConnection.get(postingDongleRoundRobinKey(workspace))) ?? '0');
  return pickFromPool(pool, seq, advance);
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
  if (job.job_type !== 'content_full' && job.job_type !== 'post_blog') return null;
  if (!postingSlotByWorkspace(String(job.workspace ?? ''))) return null;
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
    .select('id, persona, name, slot_label, proxy_port')
    .eq('id', accountId)
    .eq('account_type', 'posting')
    .maybeSingle();
  if (!data?.id) return null;
  return rowToPick(data as PostingAccountRow);
}

/** workspace·활성·proxy_port 검증 */
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

  return rowToPick(data as PostingAccountRow);
}

/** 포스팅 큐 UI — workspace 활성 계정 전체 (동글·slot_label 순) */
export async function listPostingAccounts(workspace: string): Promise<PostingAccountPick[]> {
  const rows = await loadActivePostingRows(workspace);
  return rows.map(rowToPick);
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

/** 작업 배정 — 동글별 RR + 연운은 유휴 동글 우선 병렬 */
export async function pickPostingAccount(
  workspace: string,
  options?: { advance?: boolean },
): Promise<PostingAccountPick | null> {
  if (!postingSlotByWorkspace(workspace)) return null;

  const accounts = await loadActivePostingRows(workspace);
  if (!accounts.length) return null;
  if (accounts.length === 1) return rowToPick(accounts[0]!);

  const advance = options?.advance !== false;

  if (workspace === 'yeonun') {
    const portsWithAccounts = YEONUN_POSTING_PORTS.filter((port) =>
      accounts.some((a) => a.proxy_port === port),
    );
    const targetPort = await pickPortForWorkspace(workspace, [...portsWithAccounts], advance);
    if (!targetPort) return null;
    return pickAccountOnPort(accounts, targetPort, advance);
  }

  const slot = postingSlotByWorkspace(workspace)!;
  return pickAccountOnPort(accounts, slot.proxyPort, advance);
}

/** 동글 그룹 UI — 슬롯별 계정 목록 */
export async function listPostingAccountsByDongle(workspace: string) {
  const slot = postingSlotByWorkspace(workspace);
  if (!slot) return [];

  const slots =
    workspace === 'yeonun'
      ? POSTING_DONGLE_SLOTS.filter((s) => s.workspace === 'yeonun')
      : POSTING_DONGLE_SLOTS.filter((s) => s.workspace === workspace);

  const { data: rows } = await supabase
    .from('huma_accounts')
    .select('id, name, slot_label, proxy_port, is_active, health_score, blog_index, warmup_day, post_count_today')
    .eq('workspace', workspace)
    .eq('account_type', 'posting')
    .order('proxy_port', { ascending: true })
    .order('slot_label', { ascending: true });

  const accounts = rows ?? [];

  return slots.map((dongle) => ({
    slot: dongle.slot,
    label: dongle.label,
    proxy_port: dongle.proxyPort,
    workspace: dongle.workspace,
    account_count: accounts.filter((a) => a.proxy_port === dongle.proxyPort).length,
    max_accounts: 5,
    accounts: accounts.filter((a) => a.proxy_port === dongle.proxyPort),
  }));
}
