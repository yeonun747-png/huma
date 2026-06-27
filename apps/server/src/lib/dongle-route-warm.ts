import { execFileSync } from 'node:child_process';

import { readInterfaceIp } from './dongle-health.js';
import { isPlaceholderInterfaceName, readDongleInterfaceFromConf } from './dongle-interfaces.js';

/** ZTE RNDIS 동글 게이트웨이 (huma-dongle-routes.sh 와 동일) */
export function guessDongleGateway(ip: string): string | null {
  const trimmed = ip.trim();
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(trimmed)) return null;
  if (trimmed.startsWith('192.168.42.')) return '192.168.42.129';
  const parts = trimmed.split('.');
  return `${parts[0]}.${parts[1]}.${parts[2]}.1`;
}

export function resolvePostingDongleInterface(
  slotNumber: number,
  interfaceName?: string | null,
): string | null {
  if (
    interfaceName &&
    !isPlaceholderInterfaceName(interfaceName) &&
    !interfaceName.startsWith('dongle')
  ) {
    return interfaceName;
  }
  return readDongleInterfaceFromConf(slotNumber);
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
