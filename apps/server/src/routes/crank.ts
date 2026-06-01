import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../middleware/auth.js';
import {
  getCrankSchedulerStatus,
  runDailyCrankScheduler,
} from '../lib/crank-scheduler.js';

export async function registerCrankRoutes(app: FastifyInstance) {
  app.get('/api/crank/scheduler', { preHandler: authMiddleware }, async () => {
    return getCrankSchedulerStatus();
  });

  app.post('/api/crank/scheduler/run-today', { preHandler: authMiddleware }, async (request, reply) => {
    if (!request.admin?.isSuper) {
      return reply.code(403).send({ error: 'super admin만 실행 가능' });
    }
    await runDailyCrankScheduler();
    return getCrankSchedulerStatus();
  });
}
