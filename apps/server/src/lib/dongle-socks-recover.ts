import { execSync } from 'child_process';
import { supabase } from '../middleware/auth.js';
import { readDongleInterfaceFromConf, isPlaceholderInterfaceName } from './dongle-interfaces.js';
import { readInterfaceIp } from './dongle-health.js';
import {
  applyDonglePolicyRoute,
  runRestoreDongleNetwork,
  isDongleFullRestoreCooldownActive,
} from './restore-dongle-network.js';
import { warmPostingDonglePath } from './dongle-route-warm.js';
import { applyModemProxyProbe } from './modem-proxy-probe.js';
import { probeModemSocks } from './modem-socks-probe.js';
import { isPostingProxyPort, proxyPortToSlot } from './modem-ports.js';
import { logOperation } from './log-emitter.js';
import { sleep } from './utils.js';

export type DongleSocksRecoverResult = {
  ok: boolean;
  method: 'skip' | 'route_3proxy' | 'full_restore';
  detail: string;
};

const LIGHTWEIGHT_RECOVER_ATTEMPTS = 3;

/** 3proxy egress IP 동기화 — 사설(RNDIS) IP, 공인 IP 재발급 아님 */
export function sync3proxyExternalIp(proxyPort: number, egressIp: string): void {
  if (process.platform === 'win32') return;
  try {
    execSync(
      `sed -i -E 's/^(socks|proxy) -p${proxyPort} .*/socks -p${proxyPort} -i127.0.0.1 -e${egressIp}/' /etc/3proxy/3proxy.cfg`,
      { stdio: 'pipe' },
    );
    execSync('systemctl reload 3proxy', { stdio: 'pipe' });
  } catch {
    /* dev 환경 */
  }
}

function resolveIface(slot: number, modemIface?: string | null): string | null {
  const confIface = readDongleInterfaceFromConf(slot);
  if (confIface) return confIface;
  if (modemIface && !isPlaceholderInterfaceName(modemIface)) return modemIface;
  return null;
}

async function verifySocksAndPatch(
  proxyPort: number,
  slot: number,
  modemId: string | undefined,
  iface: string | null | undefined,
  status: string,
): Promise<boolean> {
  const socks = await probeModemSocks(proxyPort);
  if (!socks.ok || !modemId) return socks.ok;
  await applyModemProxyProbe({
    id: modemId,
    slot_number: slot,
    proxy_port: proxyPort,
    status,
    interface_name: iface ?? undefined,
  });
  return socks.ok;
}

async function tryRouteAnd3proxyOnce(
  proxyPort: number,
  slot: number,
  modemId: string | undefined,
  iface: string,
  modemStatus: string,
): Promise<boolean> {
  const ip = readInterfaceIp(iface);
  if (!ip) return false;
  try {
    applyDonglePolicyRoute(iface, proxyPort);
    sync3proxyExternalIp(proxyPort, ip);
    return verifySocksAndPatch(proxyPort, slot, modemId, iface, modemStatus);
  } catch {
    return false;
  }
}

/** SOCKS 일시 지연 시 즉시 full restore 하지 않도록 경량 복구를 여러 번 시도 */
async function tryRouteAnd3proxyWithWarm(
  proxyPort: number,
  slot: number,
  modemId: string | undefined,
  initialIface: string | null,
  modemStatus: string,
): Promise<boolean> {
  for (let attempt = 0; attempt < LIGHTWEIGHT_RECOVER_ATTEMPTS; attempt += 1) {
    const iface = readDongleInterfaceFromConf(slot) ?? initialIface;
    if (!iface) return false;
    warmPostingDonglePath(slot, iface);
    if (await tryRouteAnd3proxyOnce(proxyPort, slot, modemId, iface, modemStatus)) {
      return true;
    }
    if (attempt < LIGHTWEIGHT_RECOVER_ATTEMPTS - 1) {
      await sleep(700 + attempt * 600);
    }
  }
  return false;
}

/** SOCKS 실패 — LTE·공인 IP 재발급 없이 policy routing + 3proxy → 실패 시 일괄 복구 */
export async function recoverPostingDongleSocksPath(
  proxyPort: number,
  modemId?: string,
): Promise<DongleSocksRecoverResult> {
  if (process.platform === 'win32') {
    return { ok: false, method: 'skip', detail: '동글 복구는 i7 Linux에서만 가능' };
  }
  if (!isPostingProxyPort(proxyPort)) {
    return { ok: false, method: 'skip', detail: `:${proxyPort} 포스팅 동글이 아님` };
  }

  const slot = proxyPortToSlot(proxyPort);
  const { data: modem } = await supabase
    .from('huma_modems')
    .select('id, interface_name, status')
    .eq('slot_number', slot)
    .maybeSingle();

  const resolvedModemId = modemId || (modem?.id ? String(modem.id) : undefined);
  const iface = resolveIface(slot, modem?.interface_name as string | null | undefined);
  const modemStatus = String(modem?.status ?? 'error');

  if (await tryRouteAnd3proxyWithWarm(proxyPort, slot, resolvedModemId, iface, modemStatus)) {
    return { ok: true, method: 'route_3proxy', detail: `slot${slot} routing·3proxy (:${proxyPort})` };
  }

  if (isDongleFullRestoreCooldownActive()) {
    return {
      ok: false,
      method: 'route_3proxy',
      detail: `slot${slot} 경량 복구 실패 — 일괄 복구 쿨다운 중 (전 슬롯 3proxy 재시작 방지)`,
    };
  }

  await logOperation({
    level: 'warn',
    message: `[dongle-recover] slot${slot} (:${proxyPort}) routing·3proxy 실패 — restore-dongle-by-subnet.sh`,
    modem_id: resolvedModemId,
  }).catch(() => undefined);

  const full = runRestoreDongleNetwork({ quick: true });
  if (!full.ok) {
    return {
      ok: false,
      method: full.skipped === 'cooldown' || full.skipped === 'locked' ? 'route_3proxy' : 'full_restore',
      detail: full.error ?? 'restore-dongle-by-subnet.sh 실패',
    };
  }

  const ifaceAfter = readDongleInterfaceFromConf(slot) ?? iface;
  const socksOk = await verifySocksAndPatch(
    proxyPort,
    slot,
    resolvedModemId,
    ifaceAfter,
    modemStatus,
  );
  return socksOk
    ? { ok: true, method: 'full_restore', detail: 'restore-dongle-by-subnet.sh' }
    : {
        ok: false,
        method: 'full_restore',
        detail: `복구 후 SOCKS 실패 (:${proxyPort})`,
      };
}
