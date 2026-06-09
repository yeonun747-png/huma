import type { FastifyInstance } from 'fastify';
import { authMiddleware, getWorkspaceFilter, supabase } from '../middleware/auth.js';
import { mapAccountDbError } from '../lib/account-errors.js';

/** OAuth 토큰은 API 응답에서 항상 제거 */
function stripTokens<T extends Record<string, unknown>>(row: T | null | undefined) {
  if (!row) return row;
  const { access_token: _a, refresh_token: _r, ...rest } = row;
  return rest;
}

async function assertPlatformAccountAccess(
  id: string,
  allowed: string[],
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const { data } = await supabase
    .from('huma_platform_accounts')
    .select('workspace')
    .eq('id', id)
    .maybeSingle();
  if (!data) return { ok: false, status: 404, error: '계정 없음' };
  if (!data.workspace || !allowed.includes(data.workspace)) {
    return { ok: false, status: 403, error: '워크스페이스 접근 권한 없음' };
  }
  return { ok: true };
}

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
    return stripTokens(data);
  });

  app.patch('/api/platform-accounts/:id', { preHandler: authMiddleware }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const allowed = getWorkspaceFilter(request);
    const access = await assertPlatformAccountAccess(id, allowed);
    if (!access.ok) return reply.code(access.status).send({ error: access.error });

    const body = request.body as Record<string, unknown>;
    delete body.access_token;
    delete body.refresh_token;
    // workspace 이동은 허용 범위 내에서만
    if (body.workspace && !allowed.includes(body.workspace as string)) {
      return reply.code(403).send({ error: '워크스페이스 접근 권한 없음' });
    }
    const { data, error } = await supabase.from('huma_platform_accounts').update(body).eq('id', id).select().single();
    if (error) return reply.code(400).send({ error: error.message });
    return stripTokens(data);
  });

  app.delete('/api/platform-accounts/:id', { preHandler: authMiddleware }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const access = await assertPlatformAccountAccess(id, getWorkspaceFilter(request));
    if (!access.ok) return reply.code(access.status).send({ error: access.error });
    await supabase.from('huma_platform_accounts').delete().eq('id', id);
    return { success: true };
  });
}
