import { supabase } from '../middleware/auth.js';
import { probeProxyHealth } from '../modules/human-engine/timing.js';
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
};

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

const PROBE_TIMEOUT_MS = 3500;

async function probeAndPatchModem(modem: {
  id: string;
  proxy_port: number;
  status: string | null;
}): Promise<void> {
  const health = await probeProxyHealth(modem.proxy_port, PROBE_TIMEOUT_MS);
  const patch: Record<string, unknown> = { response_ms: health.ms };
  if (health.ok) {
    if (!['busy', 'reconnecting'].includes(String(modem.status))) patch.status = 'idle';
  } else if (modem.status !== 'reconnecting') {
    patch.status = 'error';
  }
  await supabase.from('huma_modems').update(patch).eq('id', modem.id);
}

/** i7 물리 C-Rank 동글 — SOCKS probe 후 DB status 동기화 (실패해도 API는 계속) */
export async function syncCrankModemProbeStatus(
  slots: readonly number[] = [6, 7],
): Promise<void> {
  try {
    const { data, error } = await supabase
      .from('huma_modems')
      .select('id, proxy_port, status')
      .in('slot_number', [...slots]);

    if (error) {
      console.warn('[crank-modems] probe sync skip:', error.message);
      return;
    }

    const modems = (data ?? []).filter((m) => m.proxy_port);
    await Promise.all(
      modems.map((modem) =>
        probeAndPatchModem(modem as { id: string; proxy_port: number; status: string | null }).catch(
          (err) => console.warn(`[crank-modems] probe slot failed:`, err),
        ),
      ),
    );
  } catch (err) {
    console.warn('[crank-modems] probe sync error:', err);
  }
}

/** UI용 — 슬롯 6~10 전부 표시 (error·DB 누락·role 오류 포함) */
function isMissingColumnError(message: string): boolean {
  return /column .* does not exist/i.test(message);
}

export async function listCrankModemsForDashboard(): Promise<CrankModemDisplayRow[]> {
  const { data, error } = await supabase
    .from('huma_modems')
    .select(
      'id, slot_number, proxy_port, status, modem_role, monthly_data_mb, crank_sessions_today, carrier, current_ip',
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
