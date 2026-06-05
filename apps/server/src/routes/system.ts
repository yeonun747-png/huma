import type { FastifyInstance } from 'fastify';
import { authMiddleware, getWorkspaceFilter, supabase } from '../middleware/auth.js';
import { logOperation } from '../lib/log-emitter.js';
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

    const [
      { count: pendingJobs },
      { count: scheduledJobs },
      { count: runningJobs },
      { count: activeAccounts },
      { count: errors },
      { data: nextScheduled },
    ] = await Promise.all([
      supabase.from('huma_jobs').select('*', { count: 'exact', head: true }).in('workspace', workspaces).eq('status', 'pending'),
      supabase.from('huma_jobs').select('*', { count: 'exact', head: true }).in('workspace', workspaces).eq('status', 'scheduled'),
      supabase.from('huma_jobs').select('*', { count: 'exact', head: true }).in('workspace', workspaces).eq('status', 'running'),
      supabase.from('huma_accounts').select('*', { count: 'exact', head: true }).in('workspace', workspaces).eq('is_active', true),
      supabase.from('huma_logs').select('*', { count: 'exact', head: true }).in('workspace', workspaces).eq('level', 'ERROR').gte('created_at', new Date(Date.now() - 86400000).toISOString()),
      supabase
        .from('huma_jobs')
        .select('scheduled_at')
        .in('workspace', workspaces)
        .in('status', ['pending', 'scheduled'])
        .not('scheduled_at', 'is', null)
        .order('scheduled_at', { ascending: true })
        .limit(1)
        .maybeSingle(),
    ]);

    return {
      healthy: !paused,
      queueActive: !paused,
      running: !paused,
      pendingJobs: (pendingJobs ?? 0) + (scheduledJobs ?? 0),
      queued: (pendingJobs ?? 0) + (scheduledJobs ?? 0),
      liveAccounts: runningJobs ?? 0,
      nextScheduled: nextScheduled?.scheduled_at ?? null,
      activeAccounts: activeAccounts ?? 0,
      errors: errors ?? 0,
      paused,
    };
  });

  app.post('/api/stop-all', { preHandler: authMiddleware }, async (request) => {
    const body = (request.body ?? {}) as { reason?: string };
    const reason = String(body.reason ?? '').trim() || '운영자 전체 정지';
    setSystemPaused(true);
    await logOperation({
      level: 'INFO',
      message: `HUMA 전체 정지 — ${reason}`,
      metadata: { stop_reason: reason },
    });
    return { success: true, message: '전체 작업 중지됨', reason };
  });

  app.post('/api/resume-all', { preHandler: authMiddleware }, async () => {
    setSystemPaused(false);
    await logOperation({ level: 'INFO', message: 'HUMA 전체 재개' });
    return { success: true, message: '작업 재개됨' };
  });
}
