import type { FastifyInstance } from 'fastify';
import { authMiddleware, getWorkspaceFilter, supabase } from '../middleware/auth.js';
import {
  buildBlogCheckAccountsResponse,
  buildBlogCheckPostsByBlogResponse,
  buildBlogCheckPostsResponse,
  getBlogCheckScanState,
  normalizeBlogCheckScanMode,
  requestBlogCheckScan,
  requestBlogCheckSearchScan,
  resolveBlogCheckLookup,
  type BlogCheckScanOptions,
} from '../modules/blog-check/service.js';

function parseScanBody(body: unknown): BlogCheckScanOptions {
  const raw = (body ?? {}) as { mode?: string; postNos?: string[] };
  return {
    mode: normalizeBlogCheckScanMode(raw.mode),
    postNos: Array.isArray(raw.postNos) ? raw.postNos.map(String).filter(Boolean) : undefined,
  };
}

async function assertAccountAccess(accountId: string, allowed: string[]) {
  const { data: acc } = await supabase.from('huma_accounts').select('workspace').eq('id', accountId).maybeSingle();
  if (!acc || !allowed.includes(acc.workspace as string)) {
    return false;
  }
  return true;
}

export async function registerBlogCheckRoutes(app: FastifyInstance) {
  app.get('/api/blog-check/accounts', { preHandler: authMiddleware }, async (request) => {
    const allowed = getWorkspaceFilter(request);
    return buildBlogCheckAccountsResponse(allowed);
  });

  app.get('/api/blog-check/lookup', { preHandler: authMiddleware }, async (request, reply) => {
    const { q } = request.query as { q?: string };
    const allowed = getWorkspaceFilter(request);
    if (!q?.trim()) {
      return reply.code(400).send({ error: '검색어를 입력하세요' });
    }
    const result = await resolveBlogCheckLookup(q, allowed);
    if (!result) {
      return reply.code(404).send({ error: '블로그 ID를 인식할 수 없습니다' });
    }
    return result;
  });

  app.get('/api/blog-check/posts/by-blog/:blogId', { preHandler: authMiddleware }, async (request) => {
    const { blogId } = request.params as { blogId: string };
    return buildBlogCheckPostsByBlogResponse(blogId);
  });

  app.get('/api/blog-check/posts/:id', { preHandler: authMiddleware }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const allowed = getWorkspaceFilter(request);

    if (!(await assertAccountAccess(id, allowed))) {
      return reply.code(403).send({ error: '계정 접근 권한 없음' });
    }

    return buildBlogCheckPostsResponse(id);
  });

  app.get('/api/blog-check/status', { preHandler: authMiddleware }, async () => {
    return getBlogCheckScanState();
  });

  app.post('/api/blog-check/scan', { preHandler: authMiddleware }, async (request, reply) => {
    try {
      return await requestBlogCheckScan(undefined, parseScanBody(request.body));
    } catch (err) {
      const message = (err as Error).message;
      if (message === 'SCAN_ALREADY_RUNNING') {
        return reply.code(409).send({ error: '스캔이 이미 진행 중입니다' });
      }
      return reply.code(500).send({ error: message });
    }
  });

  app.post('/api/blog-check/scan/search', { preHandler: authMiddleware }, async (request, reply) => {
    const { query } = (request.body ?? {}) as { query?: string };
    const allowed = getWorkspaceFilter(request);

    if (!query?.trim()) {
      return reply.code(400).send({ error: '검색어를 입력하세요' });
    }

    try {
      return await requestBlogCheckSearchScan(query.trim(), allowed);
    } catch (err) {
      const message = (err as Error).message;
      if (message === 'SCAN_ALREADY_RUNNING') {
        return reply.code(409).send({ error: '스캔이 이미 진행 중입니다' });
      }
      if (message === '블로그 ID를 인식할 수 없습니다') {
        return reply.code(400).send({ error: message });
      }
      return reply.code(500).send({ error: message });
    }
  });

  app.post('/api/blog-check/scan/:id', { preHandler: authMiddleware }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const allowed = getWorkspaceFilter(request);

    if (!(await assertAccountAccess(id, allowed))) {
      return reply.code(403).send({ error: '계정 접근 권한 없음' });
    }

    try {
      return await requestBlogCheckScan(id, parseScanBody(request.body));
    } catch (err) {
      const message = (err as Error).message;
      if (message === 'SCAN_ALREADY_RUNNING') {
        return reply.code(409).send({ error: '스캔이 이미 진행 중입니다' });
      }
      return reply.code(500).send({ error: message });
    }
  });
}
