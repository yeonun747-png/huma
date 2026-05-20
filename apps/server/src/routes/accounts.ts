import type { FastifyInstance } from 'fastify';
import { authMiddleware, getWorkspaceFilter, supabase } from '../middleware/auth.js';
import { encrypt } from '../lib/crypto.js';

export async function registerAccountRoutes(app: FastifyInstance) {
  app.get('/api/accounts', { preHandler: authMiddleware }, async (request) => {
    const allowedWorkspaces = getWorkspaceFilter(request);
    const { data } = await supabase
      .from('huma_accounts')
      .select('*')
      .in('workspace', allowedWorkspaces)
      .order('name');
    return data ?? [];
  });

  app.post('/api/accounts', { preHandler: authMiddleware }, async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    const allowedWorkspaces = getWorkspaceFilter(request);
    if (body.workspace && !allowedWorkspaces.includes(body.workspace as string)) {
      return reply.code(403).send({ error: '워크스페이스 접근 권한 없음' });
    }
    if (body.naver_pw && typeof body.naver_pw === 'string') {
      body.naver_pw_enc = encrypt(body.naver_pw);
      delete body.naver_pw;
    }
    const { data, error } = await supabase.from('huma_accounts').insert(body).select().single();
    if (error) return reply.code(400).send({ error: error.message });
    return data;
  });

  app.patch('/api/accounts/:id', { preHandler: authMiddleware }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as Record<string, unknown>;
    const { data, error } = await supabase
      .from('huma_accounts')
      .update(body)
      .eq('id', id)
      .select()
      .single();
    if (error) return reply.code(400).send({ error: error.message });
    return data;
  });

  app.delete('/api/accounts/:id', { preHandler: authMiddleware }, async (request) => {
    const { id } = request.params as { id: string };
    await supabase.from('huma_accounts').delete().eq('id', id);
    return { success: true };
  });

  app.get('/api/accounts/:id/logs', { preHandler: authMiddleware }, async (request) => {
    const { id } = request.params as { id: string };
    const { data } = await supabase
      .from('huma_logs')
      .select('*')
      .eq('account_id', id)
      .order('created_at', { ascending: false })
      .limit(100);
    return data ?? [];
  });
}
