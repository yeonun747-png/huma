import type { FastifyInstance } from 'fastify';
import { authMiddleware, getWorkspaceFilter, supabase } from '../middleware/auth.js';

export async function registerLogRoutes(app: FastifyInstance) {
  app.get('/api/logs', { preHandler: authMiddleware }, async (request) => {
    const allowedWorkspaces = getWorkspaceFilter(request);
    const { level, platform, from, to, limit = '100' } = request.query as {
      level?: string;
      platform?: string;
      from?: string;
      to?: string;
      limit?: string;
    };

    let query = supabase
      .from('huma_logs')
      .select('*')
      .in('workspace', allowedWorkspaces)
      .order('created_at', { ascending: false })
      .limit(Number(limit));

    if (level) query = query.eq('level', level);
    if (platform) query = query.eq('platform', platform);
    if (from) query = query.gte('created_at', from);
    if (to) query = query.lte('created_at', to);

    const { data } = await query;
    return data ?? [];
  });
}
