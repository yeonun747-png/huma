import { supabase } from '../middleware/auth.js';
import { readInterfaceIp } from './dongle-health.js';
import { fetchModemPublicGeo } from './modem-geo.js';
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
  /** RNDIS/DHCP 사설 IP (재연결·3proxy용) */
  current_ip?: string | null;
  /** SOCKS egress 공인 IP */
  public_ip?: string | null;
  geo_region?: string | null;
};

async function persistModemProbePatch(id: string, patch: Record<string, unknown>): Promise<void> {
  const { error } = await supabase.from('huma_modems').update(patch).eq('id', id);
  if (error && /column .* does not exist/i.test(error.message)) {
    const { public_ip: _p, geo_region: _g, ...rest } = patch;
    await supabase.from('huma_modems').update(rest).eq('id', id);
  }
}

/**
 * 프록시 관리 `GET /api/modems?probe=1` 과 동일 절차:
 * SOCKS probe → 성공 idle / 실패 error → DB 저장
 * (reconnecting + SOCKS OK → idle 로 풀어 UI·실제 네트워크 불일치 해소)
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

  let publicIp: string | null = null;
  let geoRegion: string | null = null;

  if (health.ok) {
    // busy 제외 — reconnecting 포함, SOCKS OK면 DB 복구 (네트워크는 정상인데 UI만 재연결 고착 방지)
    if (modem.status !== 'busy') {
      patch.status = 'idle';
      nextStatus = 'idle';
    }
    const geo = await fetchModemPublicGeo(modem.proxy_port);
    publicIp = geo.public_ip;
    geoRegion = geo.geo_region;
    if (publicIp) patch.public_ip = publicIp;
    if (geoRegion) patch.geo_region = geoRegion;
  } else if (modem.status !== 'reconnecting') {
    patch.status = 'error';
    patch.public_ip = null;
    patch.geo_region = null;
    nextStatus = 'error';
  }

  if (ifaceIp) patch.current_ip = ifaceIp;

  if (options?.persist !== false && modem.id) {
    await persistModemProbePatch(modem.id, patch);
  }

  return {
    probe_ok: health.ok,
    response_ms: health.ms,
    status: nextStatus,
    current_ip: ifaceIp ?? undefined,
    public_ip: publicIp ?? undefined,
    geo_region: geoRegion ?? undefined,
  };
}

export function shouldRunModemProxyProbe(slotNumber: number, proxyPort?: number | null): boolean {
  return Boolean(proxyPort) && slotNumber <= PHYSICAL_MODEM_PROBE_MAX_SLOT;
}
