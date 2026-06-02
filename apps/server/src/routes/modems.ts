import type { FastifyInstance } from 'fastify';
import { authMiddleware, supabase } from '../middleware/auth.js';
import { reconnectModem } from '../modules/modem/reconnect.js';
import { probeProxyHealth } from '../modules/human-engine/timing.js';
import { readInterfaceIp } from '../lib/dongle-health.js';

export async function registerModemRoutes(app: FastifyInstance) {
  app.get('/api/modems', { preHandler: authMiddleware }, async (request) => {
    const probe = (request.query as { probe?: string }).probe === '1';
    const { data } = await supabase.from('huma_modems').select('*').order('slot_number');
    const modems = data ?? [];

    if (!probe) return modems;

    const updated = [];
    for (const modem of modems) {
      if (!modem.proxy_port || modem.slot_number > 7) {
        updated.push(modem);
        continue;
      }
      const health = await probeProxyHealth(modem.proxy_port);
      const ifaceIp =
        modem.interface_name && !modem.interface_name.startsWith('dongle')
          ? readInterfaceIp(modem.interface_name)
          : null;
      const patch: Record<string, unknown> = { response_ms: health.ms };
      if (health.ok) {
        if (!['busy', 'reconnecting'].includes(modem.status)) patch.status = 'idle';
      } else if (modem.status !== 'reconnecting') {
        patch.status = 'error';
      }
      if (ifaceIp) patch.current_ip = ifaceIp;
      await supabase.from('huma_modems').update(patch).eq('id', modem.id);
      updated.push({ ...modem, ...patch });
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
