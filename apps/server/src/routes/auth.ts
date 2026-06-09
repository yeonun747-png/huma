import type { FastifyInstance } from 'fastify';
import { authMiddleware, loginAdmin } from '../middleware/auth.js';
import {
  checkLoginBlocked,
  recordLoginFailure,
  clearLoginFailures,
} from '../lib/login-rate-limit.js';

const GENERIC_LOGIN_ERROR = '아이디 또는 비밀번호가 올바르지 않습니다';

export async function registerAuthRoutes(app: FastifyInstance) {
  app.post<{ Body: { username?: string; email?: string; password: string } }>(
    '/api/auth/login',
    async (request, reply) => {
      const { username, email, password } = request.body;
      const loginId = (username ?? email ?? '').trim();
      if (!loginId) {
        return reply.code(400).send({ error: '아이디를 입력하세요' });
      }
      const ip = request.ip;

      const blockedFor = await checkLoginBlocked(ip, loginId).catch(() => 0);
      if (blockedFor > 0) {
        return reply
          .code(429)
          .send({ error: `로그인 시도가 너무 많습니다. ${Math.ceil(blockedFor / 60)}분 후 다시 시도하세요` });
      }

      try {
        const result = await loginAdmin(loginId, password);
        await clearLoginFailures(ip, loginId).catch(() => {});
        return result;
      } catch (err) {
        const message = (err as Error).message;
        // Supabase 미설정 등 인프라 오류는 503으로 구분, 그 외는 계정 열거 방지를 위해 통일 메시지
        if (message.includes('Supabase')) {
          return reply.code(503).send({ error: message });
        }
        await recordLoginFailure(ip, loginId).catch(() => {});
        return reply.code(401).send({ error: GENERIC_LOGIN_ERROR });
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
