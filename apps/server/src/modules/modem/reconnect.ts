import { execSync } from 'child_process';
import { supabase } from '../../middleware/auth.js';
import { logOperation } from '../../lib/log-emitter.js';
import { sleep } from '../../lib/utils.js';

export async function reconnectModem(modemId: string) {
  const { data: modem } = await supabase.from('huma_modems').select('*').eq('id', modemId).single();
  if (!modem) throw new Error('모뎀 없음');

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
    await sleep(600000);
    await supabase.from('huma_modems').update({ status: 'idle' }).eq('id', modemId);
    await logOperation({ level: 'info', message: `모뎀 ${modem.slot_number} 재연결 완료`, modem_id: modemId });
  } catch (err) {
    await supabase.from('huma_modems').update({ status: 'error' }).eq('id', modemId);
    throw err;
  }
}
