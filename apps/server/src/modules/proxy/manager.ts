import { supabase } from '../../middleware/auth.js';

/** 프로세스 내 동시 점유 — 규칙②: 동일 슬롯 2계정 금지 */
const busyModems = new Set<string>();

export interface ModemSession {
  proxyPort: number;
  modemId: string;
  /** C-Rank idle 슬롯 임대 (세션 종료 시 반납) */
  leased: boolean;
}

export async function acquireModem(accountId: string): Promise<ModemSession | undefined> {
  const { data: account } = await supabase
    .from('huma_accounts')
    .select('modem_id, proxy_port, account_type')
    .eq('id', accountId)
    .single();

  if (!account) return undefined;

  // 포스팅 등: DB 고정 proxy_port
  if (account.proxy_port) {
    const port = account.proxy_port;
    if (busyModems.has(String(port))) {
      throw new Error('MODEM_BUSY');
    }
    busyModems.add(String(port));

    const { data: modem } = await supabase
      .from('huma_modems')
      .select('id')
      .eq('proxy_port', port)
      .maybeSingle();

    const modemId = modem?.id ?? account.modem_id;
    if (modemId) {
      await supabase.from('huma_modems').update({ status: 'busy' }).eq('id', modemId);
    }

    return { proxyPort: port, modemId: modemId ?? '', leased: false };
  }

  // C-Rank / 카페 답글: proxy_port null → crank·cafe 역할 idle 슬롯 순환
  let query = supabase
    .from('huma_modems')
    .select('*')
    .eq('status', 'idle')
    .order('slot_number');

  const { data: idleList } = await query;
  const crankPool = (idleList ?? []).filter(
    (m) => !m.modem_role || m.modem_role === 'crank' || m.modem_role === 'cafe',
  );
  for (const idle of crankPool) {    const portKey = String(idle.proxy_port);
    if (busyModems.has(portKey)) continue;

    busyModems.add(portKey);
    await supabase.from('huma_modems').update({ status: 'busy' }).eq('id', idle.id);
    return { proxyPort: idle.proxy_port, modemId: idle.id, leased: true };
  }

  throw new Error('NO_IDLE_MODEM');
}

export async function releaseModem(session: ModemSession | number): Promise<void> {
  const normalized =
    typeof session === 'number'
      ? { proxyPort: session, modemId: '', leased: false }
      : session;

  busyModems.delete(String(normalized.proxyPort));

  if (normalized.modemId) {
    await supabase
      .from('huma_modems')
      .update({ status: 'idle' })
      .eq('id', normalized.modemId)
      .neq('status', 'reconnecting');
  } else {
    await supabase
      .from('huma_modems')
      .update({ status: 'idle' })
      .eq('proxy_port', normalized.proxyPort)
      .neq('status', 'reconnecting');
  }
}

export async function getModemIdByProxyPort(proxyPort: number): Promise<string | null> {
  const { data } = await supabase
    .from('huma_modems')
    .select('id')
    .eq('proxy_port', proxyPort)
    .maybeSingle();
  return data?.id ?? null;
}
