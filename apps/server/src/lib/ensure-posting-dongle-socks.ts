import { applyModemProxyProbe } from './modem-proxy-probe.js';
import { isPostingProxyPort, proxyPortToSlot } from './modem-ports.js';
import { probeModemSocks } from './modem-socks-probe.js';
import { recoverPostingDongleSocksPath } from './dongle-socks-recover.js';
import { isRestoreFlockBusyError } from './restore-dongle-network.js';
import { sleep } from './utils.js';

export type EnsurePostingDongleSocksResult = {
  ok: boolean;
  detail: string;
  recovered: boolean;
};

/** Playwright·원격접속 전 — curl SOCKS(naver) 확인, 실패 시 경량·슬롯 복구 */
export async function ensurePostingDongleSocksReady(
  proxyPort: number,
  modemId?: string,
  options?: { recover?: boolean; context?: string },
): Promise<EnsurePostingDongleSocksResult> {
  if (!isPostingProxyPort(proxyPort)) {
    return { ok: false, detail: `:${proxyPort} 포스팅 동글이 아님`, recovered: false };
  }

  const slot = proxyPortToSlot(proxyPort);
  let socks = await probeModemSocks(proxyPort);
  if (socks.ok) {
    if (modemId) {
      await applyModemProxyProbe({
        id: modemId,
        slot_number: slot,
        proxy_port: proxyPort,
        status: 'busy',
      }).catch(() => undefined);
    }
    return { ok: true, detail: 'SOCKS 정상', recovered: false };
  }

  if (options?.recover === false) {
    return { ok: false, detail: 'SOCKS probe 실패', recovered: false };
  }

  let recover = await recoverPostingDongleSocksPath(proxyPort, modemId);
  if (
    !recover.ok &&
    (recover.detail.includes('진행 중') || isRestoreFlockBusyError(recover.detail))
  ) {
    await sleep(12_000);
    recover = await recoverPostingDongleSocksPath(proxyPort, modemId);
  }

  socks = await probeModemSocks(proxyPort);
  if (socks.ok) {
    return {
      ok: true,
      detail: recover.ok ? recover.detail : 'SOCKS probe 재확인 성공',
      recovered: recover.ok,
    };
  }

  if (modemId) {
    await applyModemProxyProbe({
      id: modemId,
      slot_number: slot,
      proxy_port: proxyPort,
      status: 'busy',
    }).catch(() => undefined);
  }

  const ctx = options?.context ? `${options.context} — ` : '';
  return {
    ok: false,
    detail: `${ctx}${recover.detail || 'SOCKS probe 실패'}`,
    recovered: false,
  };
}
