import { probeProxyHealth } from '../modules/human-engine/timing.js';

/** 프록시 관리 `/api/modems?probe=1` 과 동일 SOCKS 검사 시간 */
export const MODEM_SOCKS_PROBE_TIMEOUT_MS = 8000;

export async function probeModemSocks(
  proxyPort: number,
): Promise<{ ok: boolean; ms: number | null }> {
  return probeProxyHealth(proxyPort, MODEM_SOCKS_PROBE_TIMEOUT_MS);
}
