import type { FastifyInstance } from 'fastify';
import { authMiddleware, getWorkspaceFilter, supabase } from '../middleware/auth.js';

export async function registerDashboardRoutes(app: FastifyInstance) {
  app.get('/api/dashboard/stats', { preHandler: authMiddleware }, async (request) => {
    const workspaces = getWorkspaceFilter(request);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [
      { count: pendingJobs },
      { count: scheduledJobs },
      { count: activeAccounts },
      { count: errors },
      { count: todayCompleted },
    ] = await Promise.all([
      supabase.from('huma_jobs').select('*', { count: 'exact', head: true }).in('workspace', workspaces).eq('status', 'pending'),
      supabase.from('huma_jobs').select('*', { count: 'exact', head: true }).in('workspace', workspaces).eq('status', 'scheduled'),
      supabase.from('huma_accounts').select('*', { count: 'exact', head: true }).in('workspace', workspaces).eq('is_active', true),
      supabase.from('huma_logs').select('*', { count: 'exact', head: true }).in('workspace', workspaces).eq('level', 'ERROR').gte('created_at', today.toISOString()),
      supabase.from('huma_jobs').select('*', { count: 'exact', head: true }).in('workspace', workspaces).eq('status', 'completed').gte('completed_at', today.toISOString()),
    ]);

    const serviceStats = await Promise.all(
      workspaces.map(async (ws) => {
        const { count: jobs } = await supabase
          .from('huma_jobs')
          .select('*', { count: 'exact', head: true })
          .eq('workspace', ws)
          .eq('status', 'completed')
          .gte('completed_at', today.toISOString());
        const { count: pending } = await supabase
          .from('huma_jobs')
          .select('*', { count: 'exact', head: true })
          .eq('workspace', ws)
          .eq('status', 'pending');
        const { count: errCount } = await supabase
          .from('huma_logs')
          .select('*', { count: 'exact', head: true })
          .eq('workspace', ws)
          .eq('level', 'ERROR')
          .gte('created_at', today.toISOString());
        return { workspace: ws, todayJobs: jobs ?? 0, pending: pending ?? 0, errors: errCount ?? 0 };
      })
    );

    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    const { data: recentJobs } = await supabase
      .from('huma_jobs')
      .select('completed_at')
      .in('workspace', workspaces)
      .eq('status', 'completed')
      .gte('completed_at', sevenDaysAgo);

    const chartMap: Record<string, number> = {};
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      chartMap[d.toISOString().slice(0, 10)] = 0;
    }
    for (const j of recentJobs ?? []) {
      if (j.completed_at) {
        const key = j.completed_at.slice(0, 10);
        if (key in chartMap) chartMap[key]++;
      }
    }

    return {
      pendingJobs: (pendingJobs ?? 0) + (scheduledJobs ?? 0),
      activeAccounts: activeAccounts ?? 0,
      errors: errors ?? 0,
      todayCompleted: todayCompleted ?? 0,
      serviceStats,
      chart: Object.entries(chartMap).map(([date, value]) => ({
        day: ['일', '월', '화', '수', '목', '금', '토'][new Date(date).getDay()],
        value,
      })),
    };
  });

  app.get('/api/dashboard/recent', { preHandler: authMiddleware }, async (request) => {
    const workspaces = getWorkspaceFilter(request);
    const { data } = await supabase
      .from('huma_jobs')
      .select('title, status, result_url, workspace, completed_at')
      .in('workspace', workspaces)
      .order('created_at', { ascending: false })
      .limit(10);
    return data ?? [];
  });
}
