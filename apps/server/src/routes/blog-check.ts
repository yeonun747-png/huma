import type { FastifyInstance } from 'fastify';
import { authMiddleware, getWorkspaceFilter, supabase } from '../middleware/auth.js';
import {
  buildBlogCheckAccountsResponse,
  buildBlogCheckPostsResponse,
  getBlogCheckScanState,
  normalizeBlogCheckScanMode,
  requestBlogCheckScan,
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
