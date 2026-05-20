import { supabase } from '../../middleware/auth.js';
import { logOperation } from '../../lib/log-emitter.js';

const busyModems = new Set<string>();

export async function acquireModem(accountId: string): Promise<number | undefined> {
  const { data: account } = await supabase
    .from('huma_accounts')
    .select('modem_id, proxy_port')
    .eq('id', accountId)
    .single();

  if (account?.proxy_port) {
    if (busyModems.has(String(account.proxy_port))) {
      throw new Error('MODEM_BUSY');
    }
    busyModems.add(String(account.proxy_port));
    return account.proxy_port;
  }

  if (account?.modem_id) {
    const { data: modem } = await supabase
      .from('huma_modems')
      .select('*')
      .eq('id', account.modem_id)
      .single();
    if (modem && modem.status === 'idle') {
      await supabase.from('huma_modems').update({ status: 'busy' }).eq('id', modem.id);
      busyModems.add(String(modem.proxy_port));
      return modem.proxy_port;
    }
  }

  const { data: idle } = await supabase
    .from('huma_modems')
    .select('*')
    .eq('status', 'idle')
    .order('slot_number')
    .limit(1)
    .single();

  if (idle) {
    await supabase.from('huma_modems').update({ status: 'busy' }).eq('id', idle.id);
    busyModems.add(String(idle.proxy_port));
    return idle.proxy_port;
  }

  return undefined;
}

export function releaseModem(proxyPort: number) {
  busyModems.delete(String(proxyPort));
  supabase.from('huma_modems').update({ status: 'idle' }).eq('proxy_port', proxyPort);
}

export async function getModemProxyPort(accountId: string): Promise<number | undefined> {
  return acquireModem(accountId);
}
