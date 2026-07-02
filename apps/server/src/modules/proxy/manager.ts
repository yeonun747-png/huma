import { supabase } from '../../middleware/auth.js';
import { getModemProxyPort, releaseModemLocks } from '../modem/allocation.js';

/** 프로세스 내 동시 점유 — 규칙 ⑬: 동일 슬롯 2계정 금지 */
const busyModems = new Set<string>();

export interface ModemSession {
  proxyPort: number;
  modemId: string;
  /** C-Rank idle 슬롯 임대 (세션 종료 시 반납) */
  leased: boolean;
  lockKind: 'posting' | 'crank';
}

export async function acquireModem(
  accountId: string,
  opts?: { lockTtlSec?: number; preferredProxyPort?: number },
): Promise<ModemSession | undefined> {
  const { data: account } = await supabase
    .from('huma_accounts')
    .select('modem_id, proxy_port, account_type')
    .eq('id', accountId)
    .single();

  if (!account) return undefined;

  let proxyPort: number;
  let lockKind: 'posting' | 'crank';

  try {
    proxyPort = await getModemProxyPort(accountId, opts);
    lockKind =
      account.account_type === 'posting' && account.proxy_port === proxyPort ? 'posting' : 'crank';
  } catch (err) {
    if ((err as Error).message.includes('유휴 C-Rank')) {
      throw new Error('NO_IDLE_MODEM');
    }
    if (
      (err as Error).message.includes('C-Rank 사용 중')
    ) {
      throw new Error('MODEM_BUSY');
    }
    throw err;
  }

  const portKey = String(proxyPort);
  if (busyModems.has(portKey)) {
    await releaseModemLocks(proxyPort, lockKind);
    throw new Error('MODEM_BUSY');
  }
  busyModems.add(portKey);

  const { data: modem } = await supabase
    .from('huma_modems')
    .select('id')
    .eq('proxy_port', proxyPort)
    .maybeSingle();

  const modemId = modem?.id ?? account.modem_id ?? '';
  if (modemId) {
    await supabase.from('huma_modems').update({ status: 'busy' }).eq('id', modemId);
  }

  return { proxyPort, modemId, leased: lockKind === 'crank', lockKind };
}

export async function releaseModem(session: ModemSession | number): Promise<void> {
  const normalized: ModemSession =
    typeof session === 'number'
      ? { proxyPort: session, modemId: '', leased: false, lockKind: 'crank' }
      : session;

  busyModems.delete(String(normalized.proxyPort));
  await releaseModemLocks(normalized.proxyPort, normalized.lockKind);

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

/** 보호조치 등 — Redis·프로세스 동글 락 강제 해제 */
export async function forceReleaseModemForAccount(accountId: string): Promise<void> {
  const { data: account } = await supabase
    .from('huma_accounts')
    .select('proxy_port, modem_id')
    .eq('id', accountId)
    .maybeSingle();

  const port = account?.proxy_port as number | null | undefined;
  if (!port) return;

  busyModems.delete(String(port));
  await releaseModemLocks(port, 'posting');
  await releaseModemLocks(port, 'crank');

  const modemId = (account?.modem_id as string | null) ?? (await getModemIdByProxyPort(port));
  if (modemId) {
    await supabase
      .from('huma_modems')
      .update({ status: 'idle' })
      .eq('id', modemId)
      .neq('status', 'reconnecting');
  } else {
    await supabase
      .from('huma_modems')
      .update({ status: 'idle' })
      .eq('proxy_port', port)
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
