import { execSync } from 'child_process';
import { supabase } from '../../middleware/auth.js';
import { logOperation } from '../../lib/log-emitter.js';
import { sleep } from '../../lib/utils.js';
import { proxyPortToSlot } from '../../lib/modem-ports.js';
import { readDongleInterfaceFromConf, isPlaceholderInterfaceName } from '../../lib/dongle-interfaces.js';
import { readInterfaceIp } from '../../lib/dongle-health.js';

function sync3proxyExternalIp(proxyPort: number, newIp: string): void {
  if (process.platform === 'win32') return;
  try {
    execSync(
      `sed -i -E 's/^(socks|proxy) -p${proxyPort} .*/socks -p${proxyPort} -i127.0.0.1 -e${newIp}/' /etc/3proxy/3proxy.cfg`,
      { stdio: 'pipe' },
    );
    execSync('systemctl reload 3proxy', { stdio: 'pipe' });
  } catch {
    // dev 환경(WSL/로컬)에서는 3proxy 미설치일 수 있음
  }
}

export interface ReconnectResult {
  success: boolean;
  oldIp: string | null;
  newIp: string | null;
  modemId: string;
  slotNumber?: number;
}

/** v3.22 §7-13-1 — slot_number 기준 LTE 재연결 + 3proxy IP 갱신 */
export async function reconnectModemBySlot(slotNumber: number): Promise<string> {
  const { data: modem } = await supabase
    .from('huma_modems')
    .select('*')
    .eq('slot_number', slotNumber)
    .single();

  if (!modem) {
    throw new Error(`modem slot ${slotNumber} 없음`);
  }

  const confIface = readDongleInterfaceFromConf(slotNumber);
  const iface =
    confIface ??
    (!isPlaceholderInterfaceName(modem.interface_name) ? modem.interface_name : null);

  if (!iface) {
    throw new Error(
      `modem slot ${slotNumber} interface 없음 — /etc/huma/dongle-slot-interfaces.conf 에 ${slotNumber}=ethX 추가`,
    );
  }

  if (confIface && confIface !== modem.interface_name) {
    await supabase.from('huma_modems').update({ interface_name: confIface }).eq('slot_number', slotNumber);
  }

  const oldIp = modem.current_ip ?? readInterfaceIp(iface);

  await supabase
    .from('huma_modems')
    .update({ status: 'reconnecting', last_reconnect_at: new Date().toISOString() })
    .eq('slot_number', slotNumber);

  if (process.platform !== 'win32') {
    execSync(`sudo ip link set ${iface} down && sleep 3 && sudo ip link set ${iface} up`, {
      stdio: 'inherit',
    });
  } else {
    await sleep(3000);
  }

  await sleep(5000); // IP 재할당 완료 대기 (기술적 — 규칙 ⑦ 10분 세션 간격과 별개)
  const newIp = readInterfaceIp(iface);
  if (!newIp) {
    throw new Error(`${iface} IP 재발급 실패`);
  }

  sync3proxyExternalIp(modem.proxy_port, newIp);

  await supabase
    .from('huma_modems')
    .update({ status: 'idle', current_ip: newIp, last_reconnect_at: new Date().toISOString() })
    .eq('slot_number', slotNumber);

  await logOperation({
    level: 'info',
    message: `모뎀 slot ${slotNumber} IP 재발급 ${oldIp ?? '?'} → ${newIp}`,
    modem_id: modem.id,
  });

  return newIp;
}

/** 429 등 IP 재발급 — ifdown/ifup 후 IP 변경 확인 */
export async function reconnectModem(modemId: string): Promise<ReconnectResult> {
  const { data: modem } = await supabase.from('huma_modems').select('*').eq('id', modemId).single();
  if (!modem) throw new Error('모뎀 없음');

  const slotNumber = modem.slot_number ?? proxyPortToSlot(modem.proxy_port);

  try {
    const newIp = await reconnectModemBySlot(slotNumber);
    const oldIp = modem.current_ip;
    return {
      success: true,
      oldIp,
      newIp,
      modemId,
      slotNumber,
    };
  } catch (err) {
    await supabase.from('huma_modems').update({ status: 'error' }).eq('id', modemId);
    await logOperation({
      level: 'ERROR',
      message: `모뎀 ${slotNumber} IP 변경 실패: ${(err as Error).message}`,
      modem_id: modemId,
    });
    return {
      success: false,
      oldIp: modem.current_ip,
      newIp: null,
      modemId,
      slotNumber,
    };
  }
}