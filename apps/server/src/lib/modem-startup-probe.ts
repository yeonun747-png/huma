import { supabase } from '../middleware/auth.js';
import { runRestoreDongleNetwork } from './restore-dongle-network.js';
import { reapplyPostingDonglePolicyRoutes } from './dongle-route-warm.js';
import { applyModemProxyProbe, shouldRunModemProxyProbe } from './modem-proxy-probe.js';
import { probeModemsWithConcurrency } from './modem-socks-probe.js';
import { PHONE_CRANK_SLOTS } from './phone-crank.js';
import { sleep } from './utils.js';

const STARTUP_DELAY_MS = (() => {
  const raw = Number(process.env.HUMA_MODEM_STARTUP_DELAY_MS);
  return Number.isFinite(raw) && raw >= 0 ? raw : 25_000;
})();

/** i7 재부팅 후 stale idle·public_ip 제거 — SOCKS 실패 시 error 반영 */
export async function probePhysicalModemsOnStartup(
  log: (msg: string) => void = console.log,
): Promise<void> {
  if (process.platform === 'win32') return;
  if (process.env.HUMA_MODEM_STARTUP_PROBE === 'false') return;

  if (STARTUP_DELAY_MS > 0) {
    log(`[modem-startup-probe] USB·동글 준비 대기 ${Math.round(STARTUP_DELAY_MS / 1000)}s`);
    await sleep(STARTUP_DELAY_MS);
  }

  if (process.env.HUMA_MODEM_STARTUP_RESTORE === 'true') {
    log('[modem-startup-probe] restore-dongle-by-subnet 실행');
    const restored = runRestoreDongleNetwork();
    if (!restored.ok) {
      log(`[modem-startup-probe] restore 실패: ${restored.error ?? 'unknown'}`);
    }
  } else {
    const { applied, failed } = reapplyPostingDonglePolicyRoutes((msg) => log(msg));
    log(`[modem-startup-probe] policy route 재적용 ${applied}슬롯 OK${failed ? ` · ${failed} 실패` : ''}`);
  }

  const { data, error } = await supabase
    .from('huma_modems')
    .select('id, slot_number, proxy_port, status, interface_name')
    .lte('slot_number', 7)
    .order('slot_number');

  if (error) {
    log(`[modem-startup-probe] DB 조회 실패: ${error.message}`);
    return;
  }

  const rows = (data ?? []).filter((m) =>
    shouldRunModemProxyProbe(m.slot_number as number, m.proxy_port as number),
  );
  if (!rows.length) return;

  const phoneFirst = [...rows].sort((a, b) => {
    const aPhone = (PHONE_CRANK_SLOTS as readonly number[]).includes(a.slot_number as number) ? 0 : 1;
    const bPhone = (PHONE_CRANK_SLOTS as readonly number[]).includes(b.slot_number as number) ? 0 : 1;
    return aPhone - bPhone || (a.slot_number as number) - (b.slot_number as number);
  });

  log(`[modem-startup-probe] SOCKS 검사 시작 (${phoneFirst.length}슬롯, 실폰 우선)`);

  await probeModemsWithConcurrency(phoneFirst, 1, async (modem) => {
    const slot = modem.slot_number as number;
    try {
      const probed = await applyModemProxyProbe({
        id: modem.id as string,
        slot_number: slot,
        proxy_port: modem.proxy_port as number,
        status: String(modem.status ?? 'offline'),
        interface_name: modem.interface_name as string | null | undefined,
      });
      log(
        `[modem-startup-probe] 슬롯${slot} :${modem.proxy_port} → ${probed.status}${probed.public_ip ? ` (${probed.public_ip})` : ''}`,
      );
    } catch (err) {
      log(`[modem-startup-probe] 슬롯${slot} 오류: ${(err as Error).message}`);
    }
  });

  log('[modem-startup-probe] 완료');
}
