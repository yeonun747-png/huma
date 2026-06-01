import type { FastifyInstance } from 'fastify';
import { authMiddleware, getWorkspaceFilter, supabase } from '../middleware/auth.js';
import { encrypt } from '../lib/crypto.js';
import { mapAccountDbError } from '../lib/account-errors.js';
import {
  normalizeBlogUrl,
  POSTING_BLOG_URL_REQUIRED_MSG,
  requiresPostingBlogUrl,
} from '../lib/account-validation.js';
import {
  buildAccountsListOrFilter,
  CRANK_POOL_WORKSPACE,
  isCrankPoolAccountType,
} from '../lib/crank-pool.js';
import { ensureAccountAntiDetect } from '../modules/playwright/account-loader.js';
import {
  assertPostingProxyPortMatchesWorkspace,
  resolvePostingProxyPortForCreate,
} from '../lib/posting-proxy.js';

async function loadAccountRow(id: string) {
  const { data } = await supabase.from('huma_accounts').select('*').eq('id', id).maybeSingle();
  return data;
}

function assertAccountMutateAccess(
  account: { workspace: string; account_type: string },
  allowedWorkspaces: string[],
): boolean {
  if (isCrankPoolAccountType(account.account_type)) return true;
  return allowedWorkspaces.includes(account.workspace);
}

export async function registerAccountRoutes(app: FastifyInstance) {
  app.get('/api/accounts', { preHandler: authMiddleware }, async (request) => {
    const allowedWorkspaces = getWorkspaceFilter(request);
    const { data } = await supabase
      .from('huma_accounts')
      .select('*')
      .or(buildAccountsListOrFilter(allowedWorkspaces))
      .order('name');
    return data ?? [];
  });

  app.post('/api/accounts', { preHandler: authMiddleware }, async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    const allowedWorkspaces = getWorkspaceFilter(request);
    const crankPool = isCrankPoolAccountType(body.account_type as string);
    if (crankPool) {
      body.workspace = CRANK_POOL_WORKSPACE;
    } else if (body.workspace && !allowedWorkspaces.includes(body.workspace as string)) {
      return reply.code(403).send({ error: '워크스페이스 접근 권한 없음' });
    }
    if (body.naver_pw && typeof body.naver_pw === 'string') {
      body.naver_pw_enc = encrypt(body.naver_pw);
      delete body.naver_pw;
    }
    const accountType = (body.account_type as string) ?? 'crank';
    const blogUrl = normalizeBlogUrl(body.blog_url);
    if (requiresPostingBlogUrl(accountType) && !blogUrl) {
      return reply.code(400).send({ error: POSTING_BLOG_URL_REQUIRED_MSG });
    }
    if (blogUrl) body.blog_url = blogUrl;
    else delete body.blog_url;

    if (accountType === 'posting') {
      const ws = (body.workspace as string) ?? 'yeonun';
      body.proxy_port = await resolvePostingProxyPortForCreate(ws);
    }

    const { data, error } = await supabase.from('huma_accounts').insert(body).select().single();
    if (error) return reply.code(400).send({ error: mapAccountDbError(error.message) });
    if (data?.id) {
      await ensureAccountAntiDetect(data.id, (data.workspace as string) ?? 'yeonun');
      const { data: refreshed } = await supabase.from('huma_accounts').select('*').eq('id', data.id).single();
      return refreshed ?? data;
    }
    return data;
  });

  app.patch('/api/accounts/:id', { preHandler: authMiddleware }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as Record<string, unknown>;
    const allowedWorkspaces = getWorkspaceFilter(request);
    const existing = await loadAccountRow(id);
    if (!existing) return reply.code(404).send({ error: '계정 없음' });
    if (!assertAccountMutateAccess(existing, allowedWorkspaces)) {
      return reply.code(403).send({ error: '워크스페이스 접근 권한 없음' });
    }
    const accountType = (body.account_type as string | undefined) ?? existing.account_type;
    const blogUrl =
      body.blog_url !== undefined ? normalizeBlogUrl(body.blog_url) : normalizeBlogUrl(existing.blog_url);
    if (requiresPostingBlogUrl(accountType) && !blogUrl) {
      return reply.code(400).send({ error: POSTING_BLOG_URL_REQUIRED_MSG });
    }
    if (body.blog_url !== undefined) {
      if (blogUrl) body.blog_url = blogUrl;
      else body.blog_url = null;
    }

    const ws = (body.workspace as string | undefined) ?? existing.workspace;
    if (accountType === 'posting') {
      const nextPort = (body.proxy_port as number | undefined) ?? existing.proxy_port;
      if (nextPort) {
        assertPostingProxyPortMatchesWorkspace(ws, nextPort);
        body.proxy_port = nextPort;
      }
    }

    const { data, error } = await supabase
      .from('huma_accounts')
      .update(body)
      .eq('id', id)
      .select()
      .single();
    if (error) return reply.code(400).send({ error: error.message });
    return data;
  });

  app.delete('/api/accounts/:id', { preHandler: authMiddleware }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const allowedWorkspaces = getWorkspaceFilter(request);
    const existing = await loadAccountRow(id);
    if (!existing) return reply.code(404).send({ error: '계정 없음' });
    if (!assertAccountMutateAccess(existing, allowedWorkspaces)) {
      return reply.code(403).send({ error: '워크스페이스 접근 권한 없음' });
    }
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
