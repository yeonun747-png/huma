import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../middleware/auth.js';
import {
  getCrankSchedulerStatus,
  runDailyCrankScheduler,
} from '../lib/crank-scheduler.js';

export async function registerCrankRoutes(app: FastifyInstance) {
  app.get('/api/crank/scheduler', { preHandler: authMiddleware }, async (request, reply) => {
    try {
      const query = request.query as { probe?: string };
      const probe = query.probe === '1';
      return await getCrankSchedulerStatus({ probe });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.code(500).send({ error: message });
    }
  });

  app.post('/api/crank/scheduler/run-today', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.admin?.isSuper) {
      return reply.code(403).send({ error: 'super admin만 실행 가능' });
    }
    await runDailyCrankScheduler();
    return getCrankSchedulerStatus({ probe: true });
  });
}
