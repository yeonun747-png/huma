import type { Workspace } from '@huma/shared';
import { compareCrankLabels } from '@huma/shared';

/** v3.75 서비스별 풀 크기 — 일일 선정 비율 기준 */
export const CRANK_SERVICE_POOL: Record<Workspace, number> = {
  yeonun: 30,
  panana: 0,
  quizoasis: 20,
};

export const CRANK_SERVICE_ORDER: Workspace[] = ['yeonun', 'panana', 'quizoasis'];

export const CRANK_POOL_TOTAL = CRANK_SERVICE_ORDER.reduce(
  (s, ws) => s + CRANK_SERVICE_POOL[ws],
  0,
);

export interface CrankAccountPick {
  id: string;
  name: string;
  last_crank_at: string | null;
  crank_workspace: Workspace;
  crank_label: string | null;
}

function normalizeWorkspace(raw: string | null | undefined): Workspace {
  if (raw === 'panana' || raw === 'quizoasis') return raw;
  return 'yeonun';
}

function compareEligibleAccounts(a: CrankAccountPick, b: CrankAccountPick): number {
  if (!a.last_crank_at && !b.last_crank_at) {
    return compareCrankLabels(a.crank_label, b.crank_label);
  }
  if (!a.last_crank_at) return -1;
  if (!b.last_crank_at) return 1;
  const diff = new Date(a.last_crank_at).getTime() - new Date(b.last_crank_at).getTime();
  if (diff !== 0) return diff;
  return compareCrankLabels(a.crank_label, b.crank_label);
}

function isEligibleForCycle(lastCrankAt: string | null, cycleDays: number): boolean {
  if (!lastCrankAt) return true;
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - cycleDays);
  return new Date(lastCrankAt) < cutoff;
}

/** 서비스별 일일 할당량 (연운30·퀴즈20 비율 · 파나나 0) */
export function computeServiceDailyTargets(dailyTotal: number): Map<Workspace, number> {
  const targets = new Map<Workspace, number>();
  let assigned = 0;

  for (const ws of CRANK_SERVICE_ORDER) {
    const n = Math.floor((dailyTotal * CRANK_SERVICE_POOL[ws]) / CRANK_POOL_TOTAL);
    targets.set(ws, n);
    assigned += n;
  }

  let rem = dailyTotal - assigned;
  for (const ws of CRANK_SERVICE_ORDER) {
    if (rem <= 0) break;
    targets.set(ws, (targets.get(ws) ?? 0) + 1);
    rem--;
  }

  return targets;
}

/** 동글 2개 공유 — 슬롯 배정 순서를 서비스 교차(연운→파나나→퀴즈) */
export function interleaveCrankAccountsByService(
  byService: Map<Workspace, CrankAccountPick[]>,
): CrankAccountPick[] {
  const queues = new Map<Workspace, CrankAccountPick[]>();
  for (const ws of CRANK_SERVICE_ORDER) {
    queues.set(ws, [...(byService.get(ws) ?? [])]);
  }

  const out: CrankAccountPick[] = [];
  const total = CRANK_SERVICE_ORDER.reduce((s, ws) => s + (byService.get(ws)?.length ?? 0), 0);

  while (out.length < total) {
    let progressed = false;
    for (const ws of CRANK_SERVICE_ORDER) {
      const q = queues.get(ws)!;
      if (q.length > 0) {
        out.push(q.shift()!);
        progressed = true;
      }
    }
    if (!progressed) break;
  }

  return out;
}

/**
 * 전체 50계정(3서비스) 풀에서 일일 대상 선정 + 동글 슬롯용 교차 정렬.
 * workspace별 큐가 아니라 crank 전체를 한 번에 본다.
 */
export function selectCrankAccountsForDailySchedule(
  rows: Array<{
    id: string;
    name: string;
    last_crank_at: string | null;
    crank_workspace?: string | null;
    crank_label?: string | null;
  }>,
  cycleDays: number,
  dailyTotal: number,
): CrankAccountPick[] {
  const all: CrankAccountPick[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    last_crank_at: r.last_crank_at,
    crank_workspace: normalizeWorkspace(r.crank_workspace),
    crank_label: r.crank_label ?? null,
  }));

  const eligible = all.filter((a) => isEligibleForCycle(a.last_crank_at, cycleDays));
  const cap = Math.min(dailyTotal, eligible.length);
  const targets = computeServiceDailyTargets(cap);

  const pickedByService = new Map<Workspace, CrankAccountPick[]>();
  const pickedIds = new Set<string>();

  for (const ws of CRANK_SERVICE_ORDER) {
    const take = targets.get(ws) ?? 0;
    const pool = eligible
      .filter((a) => a.crank_workspace === ws)
      .sort(compareEligibleAccounts)
      .slice(0, take);
    for (const a of pool) pickedIds.add(a.id);
    pickedByService.set(ws, pool);
  }

  // 서비스별 비율 쿼터가 빈 풀(해당 서비스 eligible 0)로 낭비되면 일일 용량보다 적게
  // 선정된다. 남은 eligible 계정을 last_crank_at 오래된 순으로 채워 용량을 소진한다.
  if (pickedIds.size < cap) {
    const leftovers = eligible
      .filter((a) => !pickedIds.has(a.id))
      .sort(compareEligibleAccounts);
    for (const a of leftovers) {
      if (pickedIds.size >= cap) break;
      pickedByService.get(a.crank_workspace)!.push(a);
      pickedIds.add(a.id);
    }
  }

  return interleaveCrankAccountsByService(pickedByService);
}
