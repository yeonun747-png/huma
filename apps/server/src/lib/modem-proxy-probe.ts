import { supabase } from '../middleware/auth.js';
import { redisConnection } from '../modules/queue/producer.js';
import { readInterfaceIp } from './dongle-health.js';
import { preparePostingDongleForProbe, resolvePostingDongleInterface } from './dongle-route-warm.js';
import { fetchModemPublicGeo } from './modem-geo.js';
import {
  decideModemStatusAfterProbeFailure,
  readProbeFailureStreak,
  recordProbeFailureStreak,
  resetProbeFailureStreak,
} from './modem-probe-failure-streak.js';
import { probeModemSocks } from './modem-socks-probe.js';

async function hasActiveModemLease(proxyPort: number): Promise<boolean> {
  const [posting, crank] = await Promise.all([
    redisConnection.get(`modem_lock:posting:${proxyPort}`),
    redisConnection.get(`modem_lock:${proxyPort}`),
  ]);
  return Boolean(posting || crank);
}

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
  /** 연속 SOCKS 실패 (UI·로그용) */
  probe_failure_streak?: number;
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
 * SOCKS probe → 성공 idle / 연속 실패 N회 error → DB 저장
 * (reconnecting + SOCKS OK → idle 로 풀어 UI·실제 네트워크 불일치 해소)
 */
export async function applyModemProxyProbe(
  modem: ModemProbeInput,
  options?: { persist?: boolean },
): Promise<ModemProbeOutput> {
  if (modem.slot_number >= 1 && modem.slot_number <= 5) {
    preparePostingDongleForProbe(modem.slot_number, modem.interface_name);
  }

  const health = await probeModemSocks(modem.proxy_port);
  const probeIface = resolvePostingDongleInterface(modem.slot_number, modem.interface_name);
  const ifaceIp =
    probeIface && modem.slot_number <= 5
      ? readInterfaceIp(probeIface)
      : modem.interface_name && !modem.interface_name.startsWith('dongle')
        ? readInterfaceIp(modem.interface_name)
        : null;

  const patch: Record<string, unknown> = {};
  let nextStatus = modem.status;

  let publicIp: string | null = null;
  let geoRegion: string | null = null;
  let failureStreak = readProbeFailureStreak(modem.slot_number);

  if (health.ok) {
    resetProbeFailureStreak(modem.slot_number);
    failureStreak = 0;
    patch.response_ms = health.ms;

    // busy는 세션 중 보호. 단 Redis lease가 없으면 고착 상태로 보고 idle 복구
    // (일괄복구·전체정지 후에도 「사용중」이 남는 주원인)
    if (modem.status === 'busy') {
      const leased = await hasActiveModemLease(modem.proxy_port).catch(() => true);
      if (!leased) {
        patch.status = 'idle';
        nextStatus = 'idle';
      }
    } else {
      patch.status = 'idle';
      nextStatus = 'idle';
    }
    const geo = await fetchModemPublicGeo(modem.proxy_port);
    publicIp = geo.public_ip;
    geoRegion = geo.geo_region;
    if (publicIp) patch.public_ip = publicIp;
    if (geoRegion) patch.geo_region = geoRegion;
  } else {
    failureStreak = recordProbeFailureStreak(modem.slot_number);
    const decision = decideModemStatusAfterProbeFailure(modem.status, failureStreak);
    nextStatus = decision.nextStatus;

    if (decision.markError) {
      patch.status = 'error';
      patch.response_ms = health.ms;
      patch.public_ip = null;
      patch.geo_region = null;
    } else if (health.ms != null) {
      patch.response_ms = health.ms;
    }
  }

  if (ifaceIp) patch.current_ip = ifaceIp;
  if (probeIface && modem.slot_number <= 5 && health.ok) {
    patch.interface_name = probeIface;
  }

  if (options?.persist !== false && modem.id && Object.keys(patch).length > 0) {
    await persistModemProbePatch(modem.id, patch);
  }

  return {
    probe_ok: health.ok,
    response_ms: health.ms,
    status: nextStatus,
    probe_failure_streak: failureStreak,
    current_ip: ifaceIp ?? undefined,
    public_ip: publicIp ?? undefined,
    geo_region: geoRegion ?? undefined,
  };
}

export function shouldRunModemProxyProbe(slotNumber: number, proxyPort?: number | null): boolean {
  return Boolean(proxyPort) && slotNumber <= PHYSICAL_MODEM_PROBE_MAX_SLOT;
}
