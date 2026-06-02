import { supabase } from '../middleware/auth.js';
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

/** 예비·미연결 C-Rank 슬롯 (reserved 또는 crank+offline) — UI 표시용 */
export async function listReservedCrankModems(): Promise<CrankModemRow[]> {
  const { data: reserved } = await supabase
    .from('huma_modems')
    .select(
      'id, slot_number, proxy_port, status, modem_role, monthly_data_mb, crank_sessions_today, carrier, current_ip',
    )
    .eq('modem_role', 'reserved')
    .order('slot_number');

  const { data: offlineCrank } = await supabase
    .from('huma_modems')
    .select(
      'id, slot_number, proxy_port, status, modem_role, monthly_data_mb, crank_sessions_today, carrier, current_ip',
    )
    .eq('modem_role', 'crank')
    .eq('status', 'offline')
    .order('slot_number');

  return [...(reserved ?? []), ...(offlineCrank ?? [])] as CrankModemRow[];
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
