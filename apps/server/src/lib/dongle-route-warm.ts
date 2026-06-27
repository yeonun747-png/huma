import { execFileSync } from 'node:child_process';

import { applyDonglePolicyRoute } from './dongle-policy-route.js';
import { readInterfaceIp } from './dongle-health.js';
import { isPlaceholderInterfaceName, readDongleInterfaceFromConf } from './dongle-interfaces.js';
import { proxyPortToSlot } from './modem-ports.js';

/** ZTE RNDIS 동글 게이트웨이 (huma-dongle-routes.sh 와 동일) */
export function guessDongleGateway(ip: string): string | null {
  const trimmed = ip.trim();
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(trimmed)) return null;
  if (trimmed.startsWith('192.168.42.')) return '192.168.42.129';
  const parts = trimmed.split('.');
  return `${parts[0]}.${parts[1]}.${parts[2]}.1`;
}

/** UI 슬롯별 probe 시 route reapply·ping 중복 방지 (최근 warm이면 스킵) */
let lastPostingDongleRouteWarmMs = 0;
const POSTING_DONGLE_ROUTE_WARM_COOLDOWN_MS = 45_000;

export function markPostingDongleRoutesWarmed(): void {
  lastPostingDongleRouteWarmMs = Date.now();
}

export function shouldSkipPostingDonglePathWarm(): boolean {
  return Date.now() - lastPostingDongleRouteWarmMs < POSTING_DONGLE_ROUTE_WARM_COOLDOWN_MS;
}

export function resolvePostingDongleInterface(
  slotNumber: number,
  interfaceName?: string | null,
): string | null {
  // restore-dongle-by-subnet.sh 갱신 conf 우선 — DB eth0/eth1 시드값이 USB 재열거와 어긋나면 route 오적용
  const fromConf = readDongleInterfaceFromConf(slotNumber);
  if (fromConf) return fromConf;

  if (
    interfaceName &&
    !isPlaceholderInterfaceName(interfaceName) &&
    !interfaceName.startsWith('dongle')
  ) {
    return interfaceName;
  }
  return null;
}

/**
 * i7 재부팅 직후 허브 동글(1~5) — ARP·policy route cold start 완화.
 * 실폰(enx)은 warm_tether_arp 로 별도 처리되며, eth RNDIS 동글은 ping 워밍이 필요.
 */
export function warmPostingDonglePath(slotNumber: number, interfaceName?: string | null): void {
  if (process.platform === 'win32') return;
  if (slotNumber < 1 || slotNumber > 5) return;

  const iface = resolvePostingDongleInterface(slotNumber, interfaceName);
  if (!iface) return;

  const ip = readInterfaceIp(iface);
  if (!ip) return;

  const gw = guessDongleGateway(ip);
  if (!gw) return;

  try {
    execFileSync('ping', ['-c', '2', '-W', '2', '-I', iface, gw], {
      timeout: 8_000,
      stdio: 'ignore',
    });
  } catch {
    /* best effort */
  }
}

/**
 * i7 재부팅 후 /etc/huma/dongle-slot-interfaces.conf 기준 policy routing 재적용.
 * 실폰(enx)은 별도 — 허브 동글 1~5만. ping warm 포함.
 */
export function reapplyPostingDonglePolicyRoutes(
  log?: (msg: string) => void,
): { applied: number; failed: number } {
  if (process.platform === 'win32') return { applied: 0, failed: 0 };

  let applied = 0;
  let failed = 0;

  for (let slot = 1; slot <= 5; slot += 1) {
    const iface = readDongleInterfaceFromConf(slot);
    if (!iface) {
      log?.(`[dongle-route] 슬롯${slot} iface conf 없음 — 스킵`);
      failed += 1;
      continue;
    }

    warmPostingDonglePath(slot, iface);

    try {
      applyDonglePolicyRoute(iface, 10_000 + slot);
      log?.(`[dongle-route] 슬롯${slot} ${iface} → table ${10_000 + slot} policy route OK`);
      applied += 1;
    } catch (err) {
      log?.(`[dongle-route] 슬롯${slot} ${iface} policy route 실패: ${(err as Error).message}`);
      failed += 1;
    }
  }

  markPostingDongleRoutesWarmed();
  return { applied, failed };
}

/** probe 직전 — conf iface ARP warm (policy route는 reapplyPostingDonglePolicyRoutes 일괄 적용) */
export function preparePostingDongleForProbe(
  slotNumber: number,
  interfaceName?: string | null,
): void {
  if (shouldSkipPostingDonglePathWarm()) return;
  warmPostingDonglePath(slotNumber, interfaceName);
}

export function isPostingDongleProxyPort(proxyPort: number): boolean {
  return proxyPort >= 10_001 && proxyPort <= 10_005;
}

export function postingSlotFromProxyPort(proxyPort: number): number | null {
  if (!isPostingDongleProxyPort(proxyPort)) return null;
  return proxyPortToSlot(proxyPort);
}
