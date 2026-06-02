import type { FastifyInstance } from 'fastify';
import { authMiddleware, getWorkspaceFilter, supabase } from '../middleware/auth.js';
import { getSystemPaused, setSystemPaused } from '../modules/queue/worker.js';

export async function registerSystemRoutes(app: FastifyInstance) {
  app.get('/api/health', async () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '0.1.0',
  }));

  app.get('/api/status', { preHandler: authMiddleware }, async (request) => {
    const allowed = getWorkspaceFilter(request);
    const { workspace: workspaceQuery } = request.query as { workspace?: string };
    const workspaces =
      workspaceQuery && allowed.includes(workspaceQuery) ? [workspaceQuery] : allowed;
    const paused = getSystemPaused();

    const [{ count: pendingJobs }, { count: scheduledJobs }, { count: activeAccounts }, { count: errors }] = await Promise.all([
      supabase.from('huma_jobs').select('*', { count: 'exact', head: true }).in('workspace', workspaces).eq('status', 'pending'),
      supabase.from('huma_jobs').select('*', { count: 'exact', head: true }).in('workspace', workspaces).eq('status', 'scheduled'),
      supabase.from('huma_accounts').select('*', { count: 'exact', head: true }).in('workspace', workspaces).eq('is_active', true),
      supabase.from('huma_logs').select('*', { count: 'exact', head: true }).in('workspace', workspaces).eq('level', 'ERROR').gte('created_at', new Date(Date.now() - 86400000).toISOString()),
    ]);

    return {
      healthy: !paused,
      queueActive: !paused,
      pendingJobs: (pendingJobs ?? 0) + (scheduledJobs ?? 0),
      activeAccounts: activeAccounts ?? 0,
      errors: errors ?? 0,
      paused,
    };
  });

  app.post('/api/stop-all', { preHandler: authMiddleware }, async () => {
    setSystemPaused(true);
    return { success: true, message: '전체 작업 중지됨' };
  });

  app.post('/api/resume-all', { preHandler: authMiddleware }, async () => {
    setSystemPaused(false);
    return { success: true, message: '작업 재개됨' };
  });
}
