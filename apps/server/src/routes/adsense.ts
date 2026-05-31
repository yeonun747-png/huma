import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { authMiddleware, getWorkspaceFilter } from '../middleware/auth.js';
import { fetchAdSenseStats, emptyAdSenseStats, getMissingAdSenseEnvKeys, isAdSenseConfigured } from '../modules/adsense/client.js';

async function adsenseStatsHandler(request: FastifyRequest, reply: FastifyReply) {
  const workspace = String((request.query as { workspace?: string }).workspace ?? 'quizoasis');
  const allowed = getWorkspaceFilter(request);
  if (!allowed.includes(workspace)) {
    return reply.code(403).send({ error: '워크스페이스 접근 권한 없음' });
  }
  if (workspace !== 'quizoasis') {
    return reply.code(400).send({ error: 'AdSense는 퀴즈오아시스만 지원합니다' });
  }
  if (!isAdSenseConfigured(workspace)) {
    return emptyAdSenseStats(workspace);
  }

  try {
    const stats = await fetchAdSenseStats(workspace);
    return stats;
  } catch (err) {
    return reply.code(502).send({ error: (err as Error).message, configured: true });
  }
}

export async function registerAdSenseRoutes(app: FastifyInstance) {
  const routeOpts = { preHandler: authMiddleware };

  app.get('/api/monetization/config', routeOpts, async (request, reply) => {
    const workspace = String((request.query as { workspace?: string }).workspace ?? 'quizoasis');
    const allowed = getWorkspaceFilter(request);
    if (!allowed.includes(workspace)) {
      return reply.code(403).send({ error: '워크스페이스 접근 권한 없음' });
    }
    const missing = getMissingAdSenseEnvKeys(workspace);
    return {
      workspace,
      configured: missing.length === 0,
      missingEnv: missing,
    };
  });

  // 광고 차단 확장이 /adsense URL을 막는 경우가 많아 neutral 경로를 기본으로 사용
  app.get('/api/monetization/stats', routeOpts, adsenseStatsHandler);
  app.get('/api/adsense/stats', routeOpts, adsenseStatsHandler);
}
