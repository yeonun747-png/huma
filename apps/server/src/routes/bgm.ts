import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../middleware/auth.js';
import {
  downloadPixabayBgm,
  fetchPixabayBgmList,
  isAllowedPixabayUrl,
  normalizeBgmCategory,
} from '../modules/bgm/pixabay.js';

export async function registerBgmRoutes(app: FastifyInstance) {
  app.get('/api/bgm/list', { preHandler: authMiddleware }, async (request, reply) => {
    const { category = 'upbeat' } = request.query as { category?: string };

    try {
      return await fetchPixabayBgmList(category);
    } catch (err) {
      return reply.code(502).send({
        error: (err as Error).message,
        category: normalizeBgmCategory(category),
        items: [],
      });
    }
  });

  app.get('/api/bgm/download', { preHandler: authMiddleware }, async (request, reply) => {
    const { id, url } = request.query as { id?: string; url?: string };
    const numericId = Number(id);

    if (!numericId || !url) {
      return reply.code(400).send({ error: 'id와 url이 필요합니다' });
    }

    if (!isAllowedPixabayUrl(url)) {
      return reply.code(400).send({ error: 'Pixabay URL만 허용됩니다' });
    }

    try {
      const filePath = await downloadPixabayBgm(numericId, url);
      return { filePath };
    } catch (err) {
      return reply.code(502).send({ error: (err as Error).message });
    }
  });
}
