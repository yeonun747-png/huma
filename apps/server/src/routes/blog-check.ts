import type { FastifyInstance } from 'fastify';
import { authMiddleware, getWorkspaceFilter, supabase } from '../middleware/auth.js';
import {
  buildBlogCheckAccountsResponse,
  buildBlogCheckPostsResponse,
  getBlogCheckScanState,
  triggerBlogCheckScan,
} from '../modules/blog-check/service.js';

export async function registerBlogCheckRoutes(app: FastifyInstance) {
  app.get('/api/blog-check/accounts', { preHandler: authMiddleware }, async (request) => {
    const allowed = getWorkspaceFilter(request);
    return buildBlogCheckAccountsResponse(allowed);
  });

  app.get('/api/blog-check/posts/:id', { preHandler: authMiddleware }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const allowed = getWorkspaceFilter(request);

    const { data: acc } = await supabase.from('huma_accounts').select('workspace').eq('id', id).maybeSingle();
    if (!acc || !allowed.includes(acc.workspace as string)) {
      return reply.code(403).send({ error: '계정 접근 권한 없음' });
    }

    return buildBlogCheckPostsResponse(id);
  });

  app.get('/api/blog-check/status', { preHandler: authMiddleware }, async () => {
    return getBlogCheckScanState();
  });

  app.post('/api/blog-check/scan', { preHandler: authMiddleware }, async (_request, reply) => {
    try {
      return await triggerBlogCheckScan();
    } catch (err) {
      const message = (err as Error).message;
      if (message === 'SCAN_ALREADY_RUNNING') {
        return reply.code(409).send({ error: '스캔이 이미 실행 중입니다' });
      }
      return reply.code(500).send({ error: message });
    }
  });

  app.post('/api/blog-check/scan/:id', { preHandler: authMiddleware }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const allowed = getWorkspaceFilter(request);
    const { data: acc } = await supabase.from('huma_accounts').select('workspace').eq('id', id).maybeSingle();

    if (!acc || !allowed.includes(acc.workspace as string)) {
      return reply.code(403).send({ error: '계정 접근 권한 없음' });
    }

    try {
      return await triggerBlogCheckScan(id);
    } catch (err) {
      const message = (err as Error).message;
      if (message === 'SCAN_ALREADY_RUNNING') {
        return reply.code(409).send({ error: '스캔이 이미 실행 중입니다' });
      }
      return reply.code(500).send({ error: message });
    }
  });
}
