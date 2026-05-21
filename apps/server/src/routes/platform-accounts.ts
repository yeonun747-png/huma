import type { FastifyInstance } from 'fastify';
import { authMiddleware, getWorkspaceFilter, supabase } from '../middleware/auth.js';
import { mapAccountDbError } from '../lib/account-errors.js';

export async function registerPlatformAccountRoutes(app: FastifyInstance) {
  app.get('/api/platform-accounts', { preHandler: authMiddleware }, async (request) => {
    const allowed = getWorkspaceFilter(request);
    const { data } = await supabase
      .from('huma_platform_accounts')
      .select('id, workspace, platform, username, is_active, last_posted_at, post_count_today, token_expires_at, created_at')
      .in('workspace', allowed)
      .order('platform');
    return data ?? [];
  });

  app.post('/api/platform-accounts', { preHandler: authMiddleware }, async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    const allowed = getWorkspaceFilter(request);
    if (body.workspace && !allowed.includes(body.workspace as string)) {
      return reply.code(403).send({ error: '워크스페이스 접근 권한 없음' });
    }
    const { data, error } = await supabase.from('huma_platform_accounts').insert(body).select().single();
    if (error) return reply.code(400).send({ error: mapAccountDbError(error.message) });
    return data;
  });

  app.patch('/api/platform-accounts/:id', { preHandler: authMiddleware }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as Record<string, unknown>;
    delete body.access_token;
    const { data, error } = await supabase.from('huma_platform_accounts').update(body).eq('id', id).select().single();
    if (error) return reply.code(400).send({ error: error.message });
    return data;
  });

  app.delete('/api/platform-accounts/:id', { preHandler: authMiddleware }, async (request) => {
    const { id } = request.params as { id: string };
    await supabase.from('huma_platform_accounts').delete().eq('id', id);
    return { success: true };
  });
}
