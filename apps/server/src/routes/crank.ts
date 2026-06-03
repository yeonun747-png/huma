import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../middleware/auth.js';
import {
  getCrankSchedulerStatus,
  runDailyCrankScheduler,
} from '../lib/crank-scheduler.js';

export async function registerCrankRoutes(app: FastifyInstance) {
  app.get('/api/crank/scheduler', { preHandler: authMiddleware }, async (_request, reply) => {
    try {
      return await getCrankSchedulerStatus();
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
    return getCrankSchedulerStatus();
  });
}
