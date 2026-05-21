import type { FastifyInstance } from 'fastify';
import { authMiddleware, loginAdmin } from '../middleware/auth.js';

export async function registerAuthRoutes(app: FastifyInstance) {
  app.post<{ Body: { username?: string; email?: string; password: string } }>(
    '/api/auth/login',
    async (request, reply) => {
      try {
        const { username, email, password } = request.body;
        const loginId = (username ?? email ?? '').trim();
        if (!loginId) {
          return reply.code(400).send({ error: '아이디를 입력하세요' });
        }
        const result = await loginAdmin(loginId, password);
        return result;
      } catch (err) {
        const message = (err as Error).message;
        return reply.code(message.includes('Supabase') ? 503 : 401).send({ error: message });
      }
    }
  );

  app.post('/api/auth/logout', { preHandler: authMiddleware }, async () => {
    return { success: true };
  });

  app.get('/api/auth/me', { preHandler: authMiddleware }, async (request) => {
    return {
      adminId: request.admin!.adminId,
      email: request.admin!.email ?? '',
      workspaces: request.admin!.workspaces,
      isSuper: request.admin!.isSuper,
    };
  });
}
