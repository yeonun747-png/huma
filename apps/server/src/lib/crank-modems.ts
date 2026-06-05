import { supabase } from '../middleware/auth.js';
import { applyModemProxyProbe, shouldRunModemProxyProbe } from './modem-proxy-probe.js';
import { probeModemsWithConcurrency } from './modem-socks-probe.js';
import {
  MODEM_MONTHLY_DATA_CAP_MB,
  MAX_CRANK_SESSIONS_PER_MODEM_PER_DAY,
  SESSION_DATA_MB,
} from './crank-schedule-config.js';

const CRANK_MODEM_ACTIVE_STATUSES = ['idle', 'busy', 'reconnecting'] as const;

export interface CrankModemRow {
  id: string;
  slot_number: number;
  proxy_port: number;
  status: string;
  modem_role?: string;
  monthly_data_mb: number | null;
  crank_sessions_today: number | null;
  carrier?: string | null;
  current_ip?: string | null;
  interface_name?: string | null;
  response_ms?: number | null;
}

function isSchedulableCrankRow(m: {
  monthly_data_mb?: number | null;
  crank_sessions_today?: number | null;
  status?: string | null;
}): boolean {
  if (m.status === 'error' || m.status === 'offline') return false;
  const used = Number(m.monthly_data_mb ?? 0);
  if (used > MODEM_MONTHLY_DATA_CAP_MB) return false;
  const sessions = m.crank_sessions_today ?? 0;
  return sessions < MAX_CRANK_SESSIONS_PER_MODEM_PER_DAY;
}

/** 스케줄 대상 crank 동글 (modem_role=crank, idle/busy/reconnecting, 한도 이내) */
export async function listSchedulableCrankModems(): Promise<CrankModemRow[]> {
  const { data } = await supabase
    .from('huma_modems')
    .select(
      'id, slot_number, proxy_port, status, modem_role, monthly_data_mb, crank_sessions_today, carrier, current_ip',
    )
    .eq('modem_role', 'crank')
    .in('status', [...CRANK_MODEM_ACTIVE_STATUSES])
    .order('slot_number');

  return (data ?? []).filter(isSchedulableCrankRow) as CrankModemRow[];
}

const CRANK_DISPLAY_SLOTS = [6, 7, 8, 9, 10] as const;
const CRANK_SLOT_PORTS: Record<number, number> = {
  6: 10006,
  7: 10007,
  8: 10008,
  9: 10009,
  10: 10010,
};

export type CrankModemDisplayRow = CrankModemRow & {
  display_status: 'active' | 'reserved' | 'error' | 'offline' | 'missing' | 'wrong_role' | 'excluded';
  /** 물리 슬롯 6·7 — SOCKS probe 결과 (프록시 관리와 동일 기준) */
  probe_ok?: boolean;
  response_ms?: number | null;
};

/** i7 물리 C-Rank 동글 — 프록시 관리와 동일 SOCKS probe */
const PHYSICAL_CRANK_PROBE_SLOTS = [6, 7] as const;

function classifyCrankDisplayRow(m: CrankModemRow): CrankModemDisplayRow['display_status'] {
  if (m.slot_number >= 8 && (m.modem_role === 'reserved' || m.status === 'offline')) {
    return 'reserved';
  }
  if (m.modem_role && m.modem_role !== 'crank') return 'wrong_role';
  if (m.status === 'error') return 'error';
  if (m.status === 'offline') return 'offline';
  if (isSchedulableCrankRow(m)) return 'active';
  return 'excluded';
}

function isPersistableModemId(id: string): boolean {
  return Boolean(id) && !id.startsWith('missing-slot-');
}

/**
 * C-Rank 슬롯 6·7 — 프록시 관리와 동일 `applyModemProxyProbe` 결과로 표시 (DB status 무시).
 */
export async function applyLiveProbeToCrankDisplay(
  rows: CrankModemDisplayRow[],
): Promise<CrankModemDisplayRow[]> {
  const probeBySlot = new Map<number, Awaited<ReturnType<typeof applyModemProxyProbe>>>();

  const targets = rows
    .filter((r) => shouldRunModemProxyProbe(r.slot_number, r.proxy_port))
    .filter((r) => (PHYSICAL_CRANK_PROBE_SLOTS as readonly number[]).includes(r.slot_number))
    .filter((r) => isPersistableModemId(r.id));

  const probedPairs: Array<readonly [number, Awaited<ReturnType<typeof applyModemProxyProbe>>]> = [];
  await probeModemsWithConcurrency(targets, 1, async (row) => {
    const probed = await applyModemProxyProbe({
      id: row.id,
      slot_number: row.slot_number,
      proxy_port: row.proxy_port,
      status: row.status,
      interface_name: row.interface_name,
    });
    probedPairs.push([row.slot_number, probed] as const);
  });
  for (const [slot, probed] of probedPairs) probeBySlot.set(slot, probed);

  return rows.map((row) => {
    const probed = probeBySlot.get(row.slot_number);
    if (!probed) return row;

    const effectiveRow: CrankModemRow = {
      ...row,
      status: probed.status,
      ...(probed.current_ip ? { current_ip: probed.current_ip } : {}),
    };

    return {
      ...effectiveRow,
      probe_ok: probed.probe_ok,
      response_ms: probed.response_ms,
      display_status: classifyCrankDisplayRow(effectiveRow),
    };
  });
}

/** UI용 — 슬롯 6~10 전부 표시 (error·DB 누락·role 오류 포함) */
function isMissingColumnError(message: string): boolean {
  return /column .* does not exist/i.test(message);
}

export async function listCrankModemsForDashboard(): Promise<CrankModemDisplayRow[]> {
  const { data, error } = await supabase
    .from('huma_modems')
    .select(
      'id, slot_number, proxy_port, status, modem_role, monthly_data_mb, crank_sessions_today, carrier, current_ip, interface_name, response_ms',
    )
    .in('slot_number', [...CRANK_DISPLAY_SLOTS])
    .order('slot_number');

  if (error) {
    if (isMissingColumnError(error.message)) {
      throw new Error(
        'DB 마이그레이션 필요: apps/server/scripts/migrations/v3_26_social_crank_scheduler.sql',
      );
    }
    throw new Error(`동글 조회 실패: ${error.message}`);
  }

  const bySlot = new Map((data ?? []).map((m) => [m.slot_number as number, m as CrankModemRow]));

  return CRANK_DISPLAY_SLOTS.map((slot) => {
    const row = bySlot.get(slot);
    if (!row) {
      const placeholder: CrankModemRow = {
        id: `missing-slot-${slot}`,
        slot_number: slot,
        proxy_port: CRANK_SLOT_PORTS[slot],
        status: 'offline',
        modem_role: slot <= 7 ? 'crank' : 'reserved',
        monthly_data_mb: 0,
        crank_sessions_today: 0,
      };
      return { ...placeholder, display_status: 'missing' as const };
    }
    return { ...row, display_status: classifyCrankDisplayRow(row) };
  });
}

export async function countActiveCrankModems(): Promise<number> {
  const modems = await listSchedulableCrankModems();
  return modems.length;
}

/** Redis 할당용 — DB crank 포트 중 가용 슬롯 */
export async function getSchedulableCrankProxyPorts(): Promise<number[]> {
  const modems = await listSchedulableCrankModems();
  return modems.map((m) => m.proxy_port);
}

export async function recordCrankSessionOnModem(proxyPort: number): Promise<void> {
  const { data } = await supabase
    .from('huma_modems')
    .select('monthly_data_mb, crank_sessions_today')
    .eq('proxy_port', proxyPort)
    .maybeSingle();

  const monthly = Number(data?.monthly_data_mb ?? 0) + SESSION_DATA_MB;
  const sessions = (data?.crank_sessions_today ?? 0) + 1;

  await supabase
    .from('huma_modems')
    .update({
      monthly_data_mb: monthly,
      crank_sessions_today: sessions,
      status: 'idle',
    })
    .eq('proxy_port', proxyPort);
}

export async function resetAllMonthlyDataMb(): Promise<void> {
  await supabase.from('huma_modems').update({ monthly_data_mb: 0 }).eq('modem_role', 'crank');
}

export async function resetDailyCrankCounters(): Promise<void> {
  await supabase.from('huma_modems').update({ crank_sessions_today: 0 }).eq('modem_role', 'crank');
  await supabase.from('huma_accounts').update({ crank_count_today: 0 }).eq('account_type', 'crank');
}
