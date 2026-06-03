import type { FastifyInstance } from 'fastify';
import { authMiddleware, supabase } from '../middleware/auth.js';
import { reconnectModem } from '../modules/modem/reconnect.js';
import { applyModemProxyProbe, shouldRunModemProxyProbe } from '../lib/modem-proxy-probe.js';

export async function registerModemRoutes(app: FastifyInstance) {
  app.get('/api/modems', { preHandler: authMiddleware }, async (request) => {
    const probe = (request.query as { probe?: string }).probe === '1';
    const { data } = await supabase.from('huma_modems').select('*').order('slot_number');
    const modems = data ?? [];

    if (!probe) return modems;

    const updated = [];
    for (const modem of modems) {
      if (!shouldRunModemProxyProbe(modem.slot_number, modem.proxy_port)) {
        updated.push(modem);
        continue;
      }
      const probed = await applyModemProxyProbe({
        id: modem.id,
        slot_number: modem.slot_number,
        proxy_port: modem.proxy_port,
        status: modem.status,
        interface_name: modem.interface_name,
      });
      updated.push({
        ...modem,
        status: probed.status,
        response_ms: probed.response_ms,
        ...(probed.current_ip ? { current_ip: probed.current_ip } : {}),
      });
    }
    return updated;
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
      return { ...data, message: '재연결 시작됨 (10분 후 완료)' };
    } catch (err) {
      return reply.code(500).send({ error: (err as Error).message });
    }
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
