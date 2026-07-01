import { supabase } from '../middleware/auth.js';
import { YEONUN_POSTING_PORTS } from './posting-proxy.js';
import { randomBetween } from './utils.js';

/** post_blog 실행 — 다른 동글 간 최소 간격 (겹침 허용, VNC 혼선 완화) */
export const CROSS_POSTING_STAGGER_MS = 10 * 60 * 1000;

/** 같은 동글(동일 IP) 계정 — CAPTCHA/VNC 겹침 방지 (1h ±10min) */
export const SAME_DONGLE_STAGGER_MIN_MINUTES = 50;
export const SAME_DONGLE_STAGGER_MAX_MINUTES = 70;
export const SAME_DONGLE_STAGGER_MS = SAME_DONGLE_STAGGER_MIN_MINUTES * 60 * 1000;

export function randomSameDongleStaggerMs(): number {
  return randomBetween(SAME_DONGLE_STAGGER_MIN_MINUTES, SAME_DONGLE_STAGGER_MAX_MINUTES) * 60_000;
}

/** 자동발행 next_slot — 다른 동글 간 soft spread */
export const CROSS_DONGLE_AUTO_PUBLISH_STAGGER_MS = 8 * 60 * 1000;

/** @deprecated 동글-aware 로직 사용 — AUTO_PUBLISH_SAME_DONGLE_STAGGER_MS */
export const AUTO_PUBLISH_PEER_STAGGER_MS = 2 * 60_000;

export const AUTO_PUBLISH_SAME_DONGLE_STAGGER_MS = SAME_DONGLE_STAGGER_MS;

const POSTING_DONGLE_WORKSPACES = ['yeonun', 'panana', 'quizoasis'] as const;

export type PeerScheduleSlot = {
  at: Date;
  proxyPort: number | null;
};

export async function loadPostingAccountProxyPort(accountId: string): Promise<number | null> {
  const { data } = await supabase
    .from('huma_accounts')
    .select('proxy_port')
    .eq('id', accountId)
    .maybeSingle();
  const port = data?.proxy_port;
  return typeof port === 'number' ? port : null;
}

export async function listPostingDongleAccountIds(): Promise<string[]> {
  const { data } = await supabase
    .from('huma_accounts')
    .select('id, workspace, proxy_port')
    .eq('account_type', 'posting')
    .eq('is_active', true)
    .in('workspace', [...POSTING_DONGLE_WORKSPACES]);

  return (data ?? [])
    .filter((row) => {
      if (row.workspace === 'yeonun') {
        return (YEONUN_POSTING_PORTS as readonly number[]).includes(row.proxy_port as number);
      }
      return true;
    })
    .map((row) => row.id as string);
}

function jobOccupiedAt(row: {
  status?: string | null;
  scheduled_at?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
}): Date | null {
  const status = row.status ?? '';
  if (status === 'completed' && row.completed_at) {
    return new Date(row.completed_at);
  }
  if (status === 'running' || status === 'awaiting_captcha') {
    return row.started_at ? new Date(row.started_at) : new Date();
  }
  if ((status === 'scheduled' || status === 'pending') && row.scheduled_at) {
    return new Date(row.scheduled_at);
  }
  return null;
}

/**
 * 동글 포스팅 계정 전체의 post_blog 점유 시각 (다른 계정 CAPTCHA 겹침 방지용).
 */
export async function listCrossPostingOccupiedTimes(
  excludeAccountId?: string,
  lookbackMs = 24 * 3600_000,
): Promise<PeerScheduleSlot[]> {
  const accountIds = await listPostingDongleAccountIds();
  const filtered = excludeAccountId
    ? accountIds.filter((id) => id !== excludeAccountId)
    : accountIds;
  if (!filtered.length) return [];

  const sinceMs = Date.now() - lookbackMs;
  const { data } = await supabase
    .from('huma_jobs')
    .select('account_id, status, scheduled_at, started_at, completed_at')
    .eq('job_type', 'post_blog')
    .in('account_id', filtered)
    .in('status', ['completed', 'running', 'awaiting_captcha', 'scheduled', 'pending']);

  const { data: accountRows } = await supabase
    .from('huma_accounts')
    .select('id, proxy_port')
    .in('id', filtered);
  const portById = new Map(
    (accountRows ?? []).map((r) => [r.id as string, (r.proxy_port as number | null) ?? null]),
  );

  const times: PeerScheduleSlot[] = [];
  for (const row of data ?? []) {
    const accountId = row.account_id as string | null;
    const proxyPort = accountId ? (portById.get(accountId) ?? null) : null;
    const push = (at: Date) => times.push({ at, proxyPort });

    const status = row.status ?? '';
    if (status === 'running' || status === 'awaiting_captcha') {
      const at = jobOccupiedAt(row);
      if (at) push(at);
      continue;
    }
    if (status === 'completed') {
      const at = row.completed_at ? new Date(row.completed_at as string) : null;
      if (at && at.getTime() >= sinceMs) push(at);
      continue;
    }
    if (status === 'scheduled' || status === 'pending') {
      const at = row.scheduled_at ? new Date(row.scheduled_at as string) : null;
      if (at && at.getTime() >= sinceMs) push(at);
    }
  }
  return times;
}

/** candidate가 peer 시각과 staggerMs 이내면 뒤로 밀기 */
export function avoidCrossPostingCollision(
  candidate: Date,
  occupied: Date[],
  staggerMs = CROSS_POSTING_STAGGER_MS,
): Date {
  let result = new Date(candidate);
  for (let i = 0; i < 128; i++) {
    const conflict = occupied.find((t) => Math.abs(t.getTime() - result.getTime()) < staggerMs);
    if (!conflict) return result;
    result = new Date(conflict.getTime() + staggerMs + randomBetween(0, 2) * 60_000);
  }
  return result;
}

function staggerMsForPeer(
  selfPort: number | null,
  peerPort: number | null,
  sameDongleMs: number,
  crossDongleMs: number,
): number {
  if (selfPort != null && peerPort != null && selfPort === peerPort) return sameDongleMs;
  return crossDongleMs;
}

/** 자동발행 next_slot — 동글 내 강한 분산, 동글 간 soft spread */
export function avoidDongleAwareScheduleCollision(
  candidate: Date,
  peers: PeerScheduleSlot[],
  accountProxyPort: number | null,
  opts?: { sameDongleMs?: number; crossDongleMs?: number },
): Date {
  const sameMs = opts?.sameDongleMs ?? SAME_DONGLE_STAGGER_MS;
  const crossMs = opts?.crossDongleMs ?? CROSS_DONGLE_AUTO_PUBLISH_STAGGER_MS;
  let result = new Date(candidate);

  for (let i = 0; i < 128; i++) {
    let conflict: PeerScheduleSlot | undefined;
    let requiredGap = crossMs;

    for (const peer of peers) {
      const gap = staggerMsForPeer(accountProxyPort, peer.proxyPort, sameMs, crossMs);
      if (Math.abs(peer.at.getTime() - result.getTime()) < gap) {
        if (!conflict || gap > requiredGap) {
          conflict = peer;
          requiredGap = gap;
        }
      }
    }

    if (!conflict) return result;
    const bumpMs =
      accountProxyPort != null &&
      conflict.proxyPort != null &&
      accountProxyPort === conflict.proxyPort
        ? randomSameDongleStaggerMs()
        : requiredGap + randomBetween(1, 4) * 60_000;
    result = new Date(conflict.at.getTime() + bumpMs);
  }
  return result;
}

/**
 * 실행 직전 — 같은 동글 계정 CAPTCHA/발행과 겹치면 대기.
 * 다른 동글은 병렬 허용(별도 IP).
 */
export async function checkCrossPostingStagger(accountId: string): Promise<number | null> {
  const selfPort = await loadPostingAccountProxyPort(accountId);
  const occupied = await listCrossPostingOccupiedTimes(accountId);
  const now = Date.now();

  for (const { at, proxyPort } of occupied) {
    const staggerMs =
      selfPort != null && proxyPort != null && selfPort === proxyPort
        ? SAME_DONGLE_STAGGER_MS
        : 0;
    if (staggerMs <= 0) continue;

    const delta = Math.abs(at.getTime() - now);
    if (delta < staggerMs) {
      const wait = staggerMs - delta + randomBetween(15, 45) * 1000;
      return wait > 0 ? wait : staggerMs;
    }
  }

  return null;
}
