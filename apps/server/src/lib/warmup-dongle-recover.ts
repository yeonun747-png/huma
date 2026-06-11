import { supabase } from '../middleware/auth.js';
import { reconnectModemBySlot } from '../modules/modem/reconnect.js';
import { readDongleInterfaceFromConf, isPlaceholderInterfaceName } from './dongle-interfaces.js';
import { logOperation } from './log-emitter.js';
import { applyModemProxyProbe } from './modem-proxy-probe.js';
import { probeModemSocks } from './modem-socks-probe.js';
import { isPostingProxyPort, proxyPortToSlot } from './modem-ports.js';
import { runRestoreDongleNetwork } from './restore-dongle-network.js';

export function isWarmupConnectionError(err: unknown): boolean {
  const msg = (err as Error).message ?? '';
  return msg.includes('NO_LINKS_FOUND:warmup') && msg.includes('reason=connection');
}

export type WarmupDongleRecoverResult = {
  ok: boolean;
  method: 'skip' | 'slot_reconnect' | 'full_restore';
  detail: string;
};

/** post_blog 워밍업 chrome-error — 슬롯 AT 재연결 후 실패 시 restore-dongle-by-subnet.sh */
export async function recoverPostingDongleAfterWarmupConnection(
  proxyPort: number,
  modemId?: string,
): Promise<WarmupDongleRecoverResult> {
  if (process.platform === 'win32') {
    return { ok: false, method: 'skip', detail: '동글 복구는 i7 Linux에서만 가능' };
  }
  if (!isPostingProxyPort(proxyPort)) {
    return { ok: false, method: 'skip', detail: `:${proxyPort} 포스팅 동글이 아님` };
  }

  const slot = proxyPortToSlot(proxyPort);
  const confIface = readDongleInterfaceFromConf(slot);

  const { data: modem } = await supabase
    .from('huma_modems')
    .select('id, interface_name, status')
    .eq('slot_number', slot)
    .maybeSingle();

  const resolvedModemId = modemId || modem?.id;
  const ifaceMissing =
    !confIface &&
    (!modem?.interface_name || isPlaceholderInterfaceName(modem.interface_name));

  const verifyAndPatch = async (): Promise<boolean> => {
    const socks = await probeModemSocks(proxyPort);
    if (!socks.ok || !resolvedModemId) return socks.ok;
    await applyModemProxyProbe({
      id: resolvedModemId,
      slot_number: slot,
      proxy_port: proxyPort,
      status: modem?.status ?? 'error',
      interface_name: confIface ?? readDongleInterfaceFromConf(slot) ?? modem?.interface_name,
    });
    return socks.ok;
  };

  const trySlotReconnect = async (): Promise<boolean> => {
    try {
      await reconnectModemBySlot(slot, { attempt: 2 });
      return verifyAndPatch();
    } catch {
      return false;
    }
  };

  if (!ifaceMissing) {
    const slotOk = await trySlotReconnect();
    if (slotOk) {
      return { ok: true, method: 'slot_reconnect', detail: `slot${slot} (:${proxyPort})` };
    }
  }

  await logOperation({
    level: 'warn',
    message: `[post_blog] slot${slot} (:${proxyPort}) 슬롯 복구 실패 — restore-dongle-by-subnet.sh 실행`,
    modem_id: resolvedModemId,
  });

  const full = runRestoreDongleNetwork();
  if (!full.ok) {
    return {
      ok: false,
      method: 'full_restore',
      detail: full.error ?? 'restore-dongle-by-subnet.sh 실패',
    };
  }

  const socksOk = await verifyAndPatch();
  return socksOk
    ? { ok: true, method: 'full_restore', detail: 'restore-dongle-by-subnet.sh' }
    : {
        ok: false,
        method: 'full_restore',
        detail: `복구 후 SOCKS 실패 (:${proxyPort})`,
      };
}
