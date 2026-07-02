import type { FastifyInstance } from 'fastify';
import { authMiddleware, requireSuper, supabase } from '../middleware/auth.js';
import { reconnectModem } from '../modules/modem/reconnect.js';
import { applyModemProxyProbe, shouldRunModemProxyProbe } from '../lib/modem-proxy-probe.js';
import { reapplyPostingDonglePolicyRoutes, shouldSkipPostingDonglePathWarm } from '../lib/dongle-route-warm.js';
import { probeModemsWithConcurrency } from '../lib/modem-socks-probe.js';
import { runRestoreDongleNetwork } from '../lib/restore-dongle-network.js';
import { logOperation } from '../lib/log-emitter.js';

function parseProbeSlots(raw: string | undefined): Set<number> | null {
  if (!raw?.trim()) return null;
  const slots = raw
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !Number.isNaN(n));
  return slots.length > 0 ? new Set(slots) : null;
}

/** 3proxy·동글 동시 curl 시 간헐 타임아웃 — 순차 probe */
const MODEM_PROBE_CONCURRENCY = 1;
/** 슬롯당 SOCKS(~45s)+Geo(~35s)+재시도 — 7슬롯 순차 */
const MODEM_PROBE_ROUTE_MS_FULL = 600_000;
const MODEM_PROBE_ROUTE_MS_PARTIAL = 150_000;

async function probeModemsInRoute(
  modems: Array<Record<string, unknown> & { slot_number: number; proxy_port?: number | null }>,
  probeSlots: Set<number> | null,
) {
  const probeTargets = modems.filter(
    (modem) =>
      shouldRunModemProxyProbe(modem.slot_number, modem.proxy_port) &&
      (!probeSlots || probeSlots.has(modem.slot_number)),
  );

  if (
    process.platform !== 'win32' &&
    probeTargets.some((m) => m.slot_number >= 1 && m.slot_number <= 5) &&
    !shouldSkipPostingDonglePathWarm()
  ) {
    reapplyPostingDonglePolicyRoutes();
  }

  const probedBySlot = new Map<number, Awaited<ReturnType<typeof applyModemProxyProbe>>>();
  await probeModemsWithConcurrency(probeTargets, MODEM_PROBE_CONCURRENCY, async (modem) => {
    const probed = await applyModemProxyProbe({
      id: String(modem.id),
      slot_number: modem.slot_number,
      proxy_port: Number(modem.proxy_port),
      status: String(modem.status ?? 'offline'),
      interface_name: modem.interface_name as string | null | undefined,
    });
    probedBySlot.set(modem.slot_number, probed);
  });

  return modems.map((modem) => {
    const probed = probedBySlot.get(modem.slot_number);
    if (!probed) return modem;
    return {
      ...modem,
      status: probed.status,
      response_ms: probed.response_ms,
      ...(probed.current_ip ? { current_ip: probed.current_ip } : {}),
      ...(probed.public_ip ? { public_ip: probed.public_ip } : {}),
      ...(probed.geo_region ? { geo_region: probed.geo_region } : {}),
    };
  });
}

export async function registerModemRoutes(app: FastifyInstance) {
  app.get('/api/modems', { preHandler: authMiddleware }, async (request) => {
    const query = request.query as { probe?: string; slots?: string };
    const probe = query.probe === '1';
    const probeSlots = parseProbeSlots(query.slots);
    const { data } = await supabase.from('huma_modems').select('*').order('slot_number');
    const modems = data ?? [];

    if (!probe) return modems;

    const routeMs = probeSlots ? MODEM_PROBE_ROUTE_MS_PARTIAL : MODEM_PROBE_ROUTE_MS_FULL;
    const probed = await Promise.race([
      probeModemsInRoute(modems, probeSlots),
      new Promise<typeof modems>((resolve) => setTimeout(() => resolve(modems), routeMs)),
    ]);
    return probed;
  });

  app.post('/api/modems/:id/reconnect', { preHandler: authMiddleware }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      reconnectModem(id).catch((err) => {
        logOperationError(id, err);
      });
      const { data } = await supabase
        .from('huma_modems')
        .update({ status: 'reconnecting', last_reconnect_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();
      return { ...data, message: '동글 복구 시작됨' };
    } catch (err) {
      return reply.code(500).send({ error: (err as Error).message });
    }
  });

  /** UI 「동글 네트워크 복구」 — 쿨다운·락 대기 무시, SOCKS curl은 UI 재검사에 맡김 */
  app.post('/api/modems/restore-network', { preHandler: [authMiddleware, requireSuper] }, async (_request, reply) => {
    const result = runRestoreDongleNetwork({ force: true, quick: true });
    if (!result.ok) {
      await logOperation({
        level: 'ERROR',
        message: `[modems] 동글 네트워크 복구 실패: ${result.error ?? 'unknown'}`,
      });
      return reply.code(500).send({
        success: false,
        error: result.error ?? '복구 실패',
        output: result.output,
        message: result.output
          ? `${result.error ?? '복구 실패'}\n\n${result.output.slice(-2000)}`
          : result.error ?? '복구 실패',
      });
    }

    await logOperation({
      level: 'INFO',
      message: '[modems] 네트워크 복구 완료 (포스팅 동글 + C-Rank 실폰)',
    });

    return {
      success: true,
      message: '네트워크 복구 완료 (포스팅·C-Rank 실폰) — SOCKS 재검사를 실행합니다.',
      output: result.output,
    };
  });

  app.get('/api/modems/:id/ip', { preHandler: authMiddleware }, async (request) => {
    const { id } = request.params as { id: string };
    const { data } = await supabase.from('huma_modems').select('current_ip').eq('id', id).single();
    return { ip: data?.current_ip ?? null };
  });
}

async function logOperationError(modemId: string, err: unknown) {
  const { logOperation } = await import('../lib/log-emitter.js');
  await logOperation({ level: 'ERROR', message: `모뎀 재연결 실패: ${(err as Error).message}`, modem_id: modemId });
}
