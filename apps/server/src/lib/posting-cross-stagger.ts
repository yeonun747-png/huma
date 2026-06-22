import { supabase } from '../middleware/auth.js';
import { YEONUN_POSTING_PORTS } from './posting-proxy.js';
import { randomBetween } from './utils.js';

/** 연운1~3 · 퀴즈 · 파나나 — CAPTCHA/VNC 동시 처리 방지 최소 간격 */
export const CROSS_POSTING_STAGGER_MS = 10 * 60 * 1000;

const POSTING_DONGLE_WORKSPACES = ['yeonun', 'panana', 'quizoasis'] as const;

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
        return YEONUN_POSTING_PORTS.includes(row.proxy_port as number);
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
): Promise<Date[]> {
  const accountIds = await listPostingDongleAccountIds();
  const filtered = excludeAccountId
    ? accountIds.filter((id) => id !== excludeAccountId)
    : accountIds;
  if (!filtered.length) return [];

  const sinceMs = Date.now() - lookbackMs;
  const { data } = await supabase
    .from('huma_jobs')
    .select('status, scheduled_at, started_at, completed_at')
    .eq('job_type', 'post_blog')
    .in('account_id', filtered)
    .in('status', ['completed', 'running', 'awaiting_captcha', 'scheduled', 'pending']);

  const times: Date[] = [];
  const now = Date.now();
  for (const row of data ?? []) {
    const status = row.status ?? '';
    if (status === 'running' || status === 'awaiting_captcha') {
      const at = jobOccupiedAt(row);
      if (at) times.push(at);
      continue;
    }
    if (status === 'completed') {
      const at = row.completed_at ? new Date(row.completed_at as string) : null;
      if (at && at.getTime() >= sinceMs) times.push(at);
      continue;
    }
    if (status === 'scheduled' || status === 'pending') {
      const at = row.scheduled_at ? new Date(row.scheduled_at as string) : null;
      if (at && at.getTime() >= sinceMs) times.push(at);
    }
  }
  return times;
}

/** candidate가 다른 계정 점유 시각과 staggerMs 이내면 뒤로 밀기 */
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

/**
 * 실행 직전 — 다른 동글 포스팅 계정이 CAPTCHA/발행 중이거나 10분 이내 발행했으면 대기.
 */
export async function checkCrossPostingStagger(accountId: string): Promise<number | null> {
  const occupied = await listCrossPostingOccupiedTimes(accountId);
  const now = Date.now();

  for (const at of occupied) {
    const delta = Math.abs(at.getTime() - now);
    if (delta < CROSS_POSTING_STAGGER_MS) {
      const wait = CROSS_POSTING_STAGGER_MS - delta + randomBetween(15, 45) * 1000;
      return wait > 0 ? wait : CROSS_POSTING_STAGGER_MS;
    }
  }

  return null;
}
