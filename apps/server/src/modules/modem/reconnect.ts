import { execSync } from 'child_process';
import { supabase } from '../../middleware/auth.js';
import { logOperation } from '../../lib/log-emitter.js';
import { sleep } from '../../lib/utils.js';

function readInterfaceIp(interfaceName: string): string | null {
  try {
    const out = execSync(`ip -4 addr show ${interfaceName}`, { encoding: 'utf8' });
    const match = out.match(/inet\s+(\d+\.\d+\.\d+\.\d+)/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

export interface ReconnectResult {
  success: boolean;
  oldIp: string | null;
  newIp: string | null;
  modemId: string;
  slotNumber?: number;
}

/** 429 등 IP 재발급 — ifdown/ifup 후 30초 대기, IP 변경 확인 */
export async function reconnectModem(modemId: string): Promise<ReconnectResult> {
  const { data: modem } = await supabase.from('huma_modems').select('*').eq('id', modemId).single();
  if (!modem) throw new Error('모뎀 없음');

  const oldIp = modem.current_ip ?? (modem.interface_name ? readInterfaceIp(modem.interface_name) : null);

  await supabase
    .from('huma_modems')
    .update({ status: 'reconnecting', last_reconnect_at: new Date().toISOString() })
    .eq('id', modemId);

  try {
    if (modem.interface_name) {
      execSync(`sudo ifdown ${modem.interface_name} && sleep 3 && sudo ifup ${modem.interface_name}`, {
        stdio: 'inherit',
      });
    }

    await sleep(30_000);

    const newIp = modem.interface_name ? readInterfaceIp(modem.interface_name) : null;
    const changed = Boolean(newIp && newIp !== oldIp);

    if (changed && newIp) {
      await supabase
        .from('huma_modems')
        .update({ status: 'idle', current_ip: newIp })
        .eq('id', modemId);
      await logOperation({
        level: 'info',
        message: `모뎀 ${modem.slot_number} IP 재발급 ${oldIp ?? '?'} → ${newIp}`,
        modem_id: modemId,
      });
      return { success: true, oldIp, newIp, modemId, slotNumber: modem.slot_number };
    }

    await supabase.from('huma_modems').update({ status: 'error' }).eq('id', modemId);
    await logOperation({
      level: 'ERROR',
      message: `모뎀 ${modem.slot_number} IP 변경 실패 (old=${oldIp ?? '?'} new=${newIp ?? '?'})`,
      modem_id: modemId,
    });
    return { success: false, oldIp, newIp, modemId, slotNumber: modem.slot_number };
  } catch (err) {
    await supabase.from('huma_modems').update({ status: 'error' }).eq('id', modemId);
    throw err;
  }
}
