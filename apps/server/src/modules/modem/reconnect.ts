import { execSync } from 'child_process';
import { supabase } from '../../middleware/auth.js';
import { logOperation } from '../../lib/log-emitter.js';
import { sleep } from '../../lib/utils.js';
import { proxyPortToSlot } from '../../lib/modem-ports.js';
import { readDongleInterfaceFromConf, isPlaceholderInterfaceName } from '../../lib/dongle-interfaces.js';
import { readInterfaceIp } from '../../lib/dongle-health.js';
import { fetchModemPublicGeo } from '../../lib/modem-geo.js';
import { setCachedAtPort } from '../../lib/dongle-at-cache.js';
import { resetLteModem } from '../../lib/modem-lte-reset.js';
import { applyDonglePolicyRoute } from '../../lib/restore-dongle-network.js';

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

export interface ReconnectBySlotOptions {
  /** 1=빠른 AT, 2=AT하드, 3=link60+AT하드 */
  attempt?: number;
}

/** v3.22 §7-13-1 — slot_number 기준 LTE 재연결 + 3proxy IP 갱신 */
export async function reconnectModemBySlot(
  slotNumber: number,
  options?: ReconnectBySlotOptions,
): Promise<string> {
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

  try {
    if (process.platform !== 'win32') {
      const tier = Math.min(3, Math.max(1, options?.attempt ?? 1));
      const resetResult = await resetLteModem(iface, modem.proxy_port, tier, slotNumber);
      if (resetResult.atPort) await setCachedAtPort(slotNumber, resetResult.atPort);
    } else {
      await sleep(3000);
    }

    await sleep(8000); // LTE attach·DHCP 안정화
    const newIp = readInterfaceIp(iface);
    if (!newIp) {
      throw new Error(`${iface} IP 재발급 실패`);
    }

    if (process.platform !== 'win32') {
      try {
        applyDonglePolicyRoute(iface, modem.proxy_port);
      } catch (routeErr) {
        throw new Error(
          `${iface} policy routing 복구 실패: ${(routeErr as Error).message}`,
        );
      }
    }

    sync3proxyExternalIp(modem.proxy_port, newIp);

    const geo = await fetchModemPublicGeo(modem.proxy_port);
    const modemPatch: Record<string, unknown> = {
      status: 'idle',
      current_ip: newIp,
      last_reconnect_at: new Date().toISOString(),
    };
    if (geo.public_ip) modemPatch.public_ip = geo.public_ip;
    if (geo.geo_region) modemPatch.geo_region = geo.geo_region;

    await supabase.from('huma_modems').update(modemPatch).eq('slot_number', slotNumber);

    await logOperation({
      level: 'info',
      message: `모뎀 slot ${slotNumber} IP 재발급 ${oldIp ?? '?'} → ${newIp} (공인 ${geo.public_ip ?? '?'})`,
      modem_id: modem.id,
    });

    return newIp;
  } catch (err) {
    await supabase.from('huma_modems').update({ status: 'error' }).eq('slot_number', slotNumber);
    throw err;
  }
}

/** 429 등 IP 재발급 — ifdown/ifup 후 IP 변경 확인 */
export async function reconnectModem(modemId: string): Promise<ReconnectResult> {
  const { data: modem } = await supabase.from('huma_modems').select('*').eq('id', modemId).single();
  if (!modem) throw new Error('모뎀 없음');

  const slotNumber = modem.slot_number ?? proxyPortToSlot(modem.proxy_port);
  const oldPublicIp = modem.public_ip ?? null;

  const readPublicIp = async (): Promise<string | null> => {
    const { data } = await supabase
      .from('huma_modems')
      .select('public_ip')
      .eq('slot_number', slotNumber)
      .maybeSingle();
    return data?.public_ip ?? null;
  };

  try {
    let newIp = await reconnectModemBySlot(slotNumber);
    let newPublicIp = await readPublicIp();

    // 429 재발급의 핵심은 공인 IP 교체. 사설(RNDIS) IP만 보고 성공 판단하면 안 됨.
    // 공인 IP가 그대로면 상위 tier로 1회 더 시도.
    if (oldPublicIp && newPublicIp && newPublicIp === oldPublicIp) {
      await logOperation({
        level: 'warn',
        message: `모뎀 slot ${slotNumber} 공인 IP 미변경(${oldPublicIp}) — tier2 재시도`,
        modem_id: modemId,
      });
      newIp = await reconnectModemBySlot(slotNumber, { attempt: 2 });
      newPublicIp = await readPublicIp();
    }

    const publicRotated = !oldPublicIp || !newPublicIp || newPublicIp !== oldPublicIp;
    if (!publicRotated) {
      await logOperation({
        level: 'ERROR',
        message: `모뎀 slot ${slotNumber} 공인 IP 교체 실패 — 여전히 ${oldPublicIp}`,
        modem_id: modemId,
      });
      return { success: false, oldIp: modem.current_ip, newIp, modemId, slotNumber };
    }

    return {
      success: true,
      oldIp: modem.current_ip,
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