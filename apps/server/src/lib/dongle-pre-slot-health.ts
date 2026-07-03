import { supabase } from '../middleware/auth.js';
import { applyModemProxyProbe } from './modem-proxy-probe.js';
import { isPostingProxyPort, proxyPortToSlot } from './modem-ports.js';
import { probeModemSocks } from './modem-socks-probe.js';
import { recoverPostingDongleSocksPath } from './dongle-socks-recover.js';
import { logOperation } from './log-emitter.js';
import { getSystemPaused } from './system-pause.js';
import { redisConnection } from '../modules/queue/producer.js';

/** 다음 content_full 등록 시각 기준 — 이 시간 이내면 사전 동글 점검·복구 */
export const DONGLE_PRE_SLOT_HEALTH_LEAD_MS = 10 * 60_000;

function postingLockKey(port: number): string {
  return `modem_lock:posting:${port}`;
}

/** accountId → 마지막으로 사전 점검 완료한 next_slot_at */
const preSlotHealthDone = new Map<string, string>();

export function isWithinPreSlotHealthWindow(
  nextSlotAtIso: string,
  nowMs = Date.now(),
  leadMs = DONGLE_PRE_SLOT_HEALTH_LEAD_MS,
): boolean {
  const remaining = Date.parse(nextSlotAtIso) - nowMs;
  return Number.isFinite(remaining) && remaining > 0 && remaining <= leadMs;
}

function prunePreSlotHealthDone(nowMs = Date.now()): void {
  for (const [accountId, slotAt] of preSlotHealthDone) {
    const end = Date.parse(slotAt);
    if (!Number.isFinite(end) || end < nowMs - 60_000) {
      preSlotHealthDone.delete(accountId);
    }
  }
}

async function isPostingDongleOccupied(proxyPort: number): Promise<boolean> {
  if (await redisConnection.get(postingLockKey(proxyPort))) return true;

  const { data } = await supabase
    .from('huma_modems')
    .select('status')
    .eq('proxy_port', proxyPort)
    .maybeSingle();

  const status = data?.status as string | undefined;
  return status === 'busy' || status === 'reconnecting';
}

/**
 * 자동발행 next_slot_at 10분 전 — 해당 포스팅 계정 동글 SOCKS 점검, 실패 시 복구.
 * busy/reconnecting·Redis 락 중이면 건너뜀 (진행 중 세션 보호).
 */
export async function runDonglePreSlotHealthChecks(): Promise<number> {
  if (process.platform === 'win32') return 0;
  if (getSystemPaused()) return 0;

  prunePreSlotHealthDone();

  const { data: accounts, error } = await supabase
    .from('huma_accounts')
    .select('id, name, slot_label, proxy_port, auto_publish_next_slot_at')
    .eq('auto_publish_enabled', true)
    .eq('account_type', 'posting')
    .not('auto_publish_next_slot_at', 'is', null);

  if (error) {
    console.error('[dongle-pre-slot] account load:', error.message);
    return 0;
  }

  let recovered = 0;
  const now = Date.now();

  for (const row of accounts ?? []) {
    const accountId = String(row.id);
    const slotAt = String(row.auto_publish_next_slot_at ?? '');
    if (!isWithinPreSlotHealthWindow(slotAt, now)) continue;
    if (preSlotHealthDone.get(accountId) === slotAt) continue;

    const proxyPort = row.proxy_port as number | null | undefined;
    if (!proxyPort || !isPostingProxyPort(proxyPort)) continue;

    const slot = proxyPortToSlot(proxyPort);
    const label = (row.slot_label as string | null) ?? (row.name as string | null) ?? `slot${slot}`;
    const remainingMin = Math.max(1, Math.round((Date.parse(slotAt) - now) / 60_000));

    if (await isPostingDongleOccupied(proxyPort)) {
      await logOperation({
        level: 'info',
        message: `[dongle-pre-slot] skip ${label} :${proxyPort} — 세션 사용 중 (다음 큐 등록 ${remainingMin}분 전)`,
        account_id: accountId,
      }).catch(() => undefined);
      continue;
    }

    const { data: modem } = await supabase
      .from('huma_modems')
      .select('id, slot_number, proxy_port, status, interface_name')
      .eq('proxy_port', proxyPort)
      .maybeSingle();

    const socks = await probeModemSocks(proxyPort);
    if (socks.ok) {
      if (modem?.id) {
        await applyModemProxyProbe({
          id: String(modem.id),
          slot_number: Number(modem.slot_number ?? slot),
          proxy_port: proxyPort,
          status: String(modem.status ?? 'idle'),
          interface_name: modem.interface_name as string | null | undefined,
        });
      }
      await logOperation({
        level: 'info',
        message: `[dongle-pre-slot] ${label} :${proxyPort} SOCKS 정상 (다음 큐 등록 ${remainingMin}분 전)`,
        account_id: accountId,
        modem_id: modem?.id ? String(modem.id) : undefined,
      }).catch(() => undefined);
      preSlotHealthDone.set(accountId, slotAt);
      continue;
    }

    await logOperation({
      level: 'warn',
      message: `[dongle-pre-slot] ${label} :${proxyPort} SOCKS 실패 — 복구 시도 (다음 큐 등록 ${remainingMin}분 전)`,
      account_id: accountId,
      modem_id: modem?.id ? String(modem.id) : undefined,
    }).catch(() => undefined);

    const recover = await recoverPostingDongleSocksPath(
      proxyPort,
      modem?.id ? String(modem.id) : undefined,
    );

    await logOperation({
      level: recover.ok ? 'info' : 'ERROR',
      message: `[dongle-pre-slot] ${label} 복구 ${recover.ok ? '성공' : '실패'} (${recover.method}: ${recover.detail})`,
      account_id: accountId,
      modem_id: modem?.id ? String(modem.id) : undefined,
    }).catch(() => undefined);

    if (recover.ok) recovered += 1;
    else continue;

    preSlotHealthDone.set(accountId, slotAt);
  }

  return recovered;
}
