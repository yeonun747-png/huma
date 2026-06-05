import type { FastifyInstance } from 'fastify';
import { authMiddleware, getWorkspaceFilter } from '../middleware/auth.js';
import { buildSeoKeywords, crawlAndStoreSeo, getSeoKeywords } from '../modules/seo/keywords-service.js';

export async function registerSeoRoutes(app: FastifyInstance) {
  app.get('/api/seo/keywords', { preHandler: authMiddleware }, async (request, reply) => {
    const allowed = getWorkspaceFilter(request);
    const { workspace = allowed[0] } = request.query as { workspace?: string };
    if (!workspace || !allowed.includes(workspace)) {
      return reply.code(403).send({ error: '워크스페이스 접근 권한 없음' });
    }
    return getSeoKeywords(workspace);
  });

  app.post('/api/seo/crawl', { preHandler: authMiddleware }, async (request, reply) => {
    const allowed = getWorkspaceFilter(request);
    const { workspace = allowed[0] } = request.query as { workspace?: string };
    if (!workspace || !allowed.includes(workspace)) {
      return reply.code(403).send({ error: '워크스페이스 접근 권한 없음' });
    }
    try {
      return await crawlAndStoreSeo(workspace);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.code(500).send({ error: message });
    }
  });

  app.get('/api/seo/status', { preHandler: authMiddleware }, async (request) => {
    const allowed = getWorkspaceFilter(request);
    const results = await Promise.all(
      allowed.map(async (ws) => {
        const data = await buildSeoKeywords(ws);
        return { workspace: ws, source: data.source, configured: data.configured, rankCount: data.ranks.length };
      }),
    );
    return results;
  });
}
