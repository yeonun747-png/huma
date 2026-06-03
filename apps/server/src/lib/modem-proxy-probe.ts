import { supabase } from '../middleware/auth.js';
import { readInterfaceIp } from './dongle-health.js';
import { probeModemSocks } from './modem-socks-probe.js';

/** 물리 동글 SOCKS probe 대상 (프록시 관리와 동일: 슬롯 1~7) */
export const PHYSICAL_MODEM_PROBE_MAX_SLOT = 7;

export type ModemProbeInput = {
  id: string;
  slot_number: number;
  proxy_port: number;
  status: string;
  interface_name?: string | null;
};

export type ModemProbeOutput = {
  probe_ok: boolean;
  response_ms: number | null;
  status: string;
  current_ip?: string | null;
};

/**
 * 프록시 관리 `GET /api/modems?probe=1` 과 동일 절차:
 * SOCKS probe → 성공 idle / 실패 error → DB 저장
 */
export async function applyModemProxyProbe(
  modem: ModemProbeInput,
  options?: { persist?: boolean },
): Promise<ModemProbeOutput> {
  const health = await probeModemSocks(modem.proxy_port);
  const ifaceIp =
    modem.interface_name && !modem.interface_name.startsWith('dongle')
      ? readInterfaceIp(modem.interface_name)
      : null;

  const patch: Record<string, unknown> = { response_ms: health.ms };
  let nextStatus = modem.status;

  if (health.ok) {
    if (!['busy', 'reconnecting'].includes(modem.status)) {
      patch.status = 'idle';
      nextStatus = 'idle';
    }
  } else if (modem.status !== 'reconnecting') {
    patch.status = 'error';
    nextStatus = 'error';
  }

  if (ifaceIp) patch.current_ip = ifaceIp;

  if (options?.persist !== false && modem.id) {
    await supabase.from('huma_modems').update(patch).eq('id', modem.id);
  }

  return {
    probe_ok: health.ok,
    response_ms: health.ms,
    status: nextStatus,
    current_ip: ifaceIp ?? undefined,
  };
}

export function shouldRunModemProxyProbe(slotNumber: number, proxyPort?: number | null): boolean {
  return Boolean(proxyPort) && slotNumber <= PHYSICAL_MODEM_PROBE_MAX_SLOT;
}
