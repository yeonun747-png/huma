import type { FastifyInstance } from 'fastify';
import { authMiddleware, getWorkspaceFilter, supabase } from '../middleware/auth.js';
import { encrypt } from '../lib/crypto.js';
import { mapAccountDbError } from '../lib/account-errors.js';
import { deleteAccountById } from '../lib/delete-account.js';
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
  assertDongleCapacity,
  generateAutoSlotLabel,
  resolvePostingProxyPortForCreate,
} from '../lib/posting-proxy.js';
import { mergeBlogWritingPersonaField } from '../lib/account-persona.js';
import { type Workspace } from '@huma/shared';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidAccountId(id: string): boolean {
  return UUID_RE.test(id.trim());
}

/** 암호화된 네이버 비밀번호는 API 응답에서 항상 제거 */
function stripAccountSecret<T extends Record<string, unknown>>(row: T | null | undefined) {
  if (!row) return row;
  const { naver_pw_enc: _omit, ...rest } = row;
  return rest;
}

async function loadAccountRow(id: string) {
  const trimmed = id.trim();
  if (!isValidAccountId(trimmed)) {
    return { data: null as Record<string, unknown> | null, loadError: 'INVALID_ID' as const };
  }
  const { data, error } = await supabase
    .from('huma_accounts')
    .select('*')
    .eq('id', trimmed)
    .maybeSingle();
  if (error) {
    return { data: null, loadError: error.message };
  }
  return { data, loadError: null as string | null };
}

function parseLookupProxyPort(body: Record<string, unknown>): number | undefined {
  const raw = body.lookup_proxy_port;
  if (typeof raw === 'number' && !Number.isNaN(raw)) return raw;
  if (typeof raw === 'string' && raw.trim()) {
    const n = Number(raw);
    return Number.isNaN(n) ? undefined : n;
  }
  return undefined;
}

async function findYeonunPostingByProxyPort(proxyPort: number) {
  const { data, error } = await supabase
    .from('huma_accounts')
    .select('*')
    .eq('workspace', 'yeonun')
    .eq('account_type', 'posting')
    .eq('proxy_port', proxyPort)
    .maybeSingle();
  if (error) return { data: null, loadError: error.message };
  return { data, loadError: null as string | null };
}

function accountWorkspace(account: {
  workspace?: string | null;
  shared_workspace?: string | null;
}): string {
  return String(account.workspace ?? account.shared_workspace ?? '').trim();
}

function assertAccountMutateAccess(
  account: { workspace?: string | null; shared_workspace?: string | null; account_type: string },
  allowedWorkspaces: string[],
): boolean {
  if (isCrankPoolAccountType(account.account_type)) return true;
  const ws = accountWorkspace(account);
  if (!ws) return true;
  return allowedWorkspaces.includes(ws);
}

function isPersonaOnlyPatch(body: Record<string, unknown>, patch: Record<string, unknown>): boolean {
  const personaKeys = new Set(['persona']);
  const patchKeys = Object.keys(patch);
  return (
    patchKeys.length > 0 &&
    patchKeys.every((k) => personaKeys.has(k)) &&
    (typeof body.blog_writing_persona === 'string' || body.persona !== undefined)
  );
}

export async function registerAccountRoutes(app: FastifyInstance) {
  app.get('/api/accounts', { preHandler: authMiddleware }, async (request) => {
    const allowedWorkspaces = getWorkspaceFilter(request);
    const { data } = await supabase
      .from('huma_accounts')
      .select('*')
      .or(buildAccountsListOrFilter(allowedWorkspaces))
      .order('name');
    // 암호화된 네이버 비밀번호는 API 응답으로 절대 내보내지 않는다 (복호화 표면 축소)
    return (data ?? []).map(({ naver_pw_enc: _omit, ...rest }) => rest);
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
      const requestedPort =
        typeof body.proxy_port === 'number' && !Number.isNaN(body.proxy_port)
          ? (body.proxy_port as number)
          : undefined;
      body.proxy_port = await resolvePostingProxyPortForCreate(ws, requestedPort);
      const slotLabel = typeof body.slot_label === 'string' ? body.slot_label.trim() : '';
      if (!slotLabel) {
        body.slot_label = await generateAutoSlotLabel(body.proxy_port as number);
      }
      const displayName = typeof body.name === 'string' ? body.name.trim() : '';
      if (!displayName) {
        body.name = body.slot_label;
      }
    }

    const { data, error } = await supabase.from('huma_accounts').insert(body).select().single();
    if (error) return reply.code(400).send({ error: mapAccountDbError(error.message) });
    if (data?.id) {
      await ensureAccountAntiDetect(data.id, (data.workspace as string) ?? 'yeonun');
      const { data: refreshed } = await supabase.from('huma_accounts').select('*').eq('id', data.id).single();
      return stripAccountSecret(refreshed ?? data);
    }
    return stripAccountSecret(data);
  });

  app.patch('/api/accounts/:id/blog-persona', { preHandler: authMiddleware }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const body = request.body as {
        text?: string;
        blogWritingPersona?: string;
        proxy_port?: number;
      };
      const text = (body.text ?? body.blogWritingPersona ?? '').trim();
      if (!text) {
        return reply.code(400).send({ error: '블로그 문체 지침이 비어 있습니다' });
      }

      const allowedWorkspaces = getWorkspaceFilter(request);
      let existing: Record<string, unknown> | null = null;
      let loadError: string | null = null;

      const loaded = await loadAccountRow(id);
      existing = loaded.data;
      loadError = loaded.loadError;

      if (loadError === 'INVALID_ID') {
        return reply.code(400).send({
          error: `잘못된 계정 id (${id}). huma_accounts에 UUID로 등록된 포스팅 계정인지 확인하세요.`,
        });
      }

      if (!existing && typeof body.proxy_port === 'number') {
        const byPort = await findYeonunPostingByProxyPort(body.proxy_port);
        existing = byPort.data;
        loadError = byPort.loadError;
      }

      if (!existing) {
        const lookupPort = parseLookupProxyPort(body as Record<string, unknown>);
        if (lookupPort != null) {
          const byPort = await findYeonunPostingByProxyPort(lookupPort);
          existing = byPort.data;
          loadError = byPort.loadError;
        }
      }

      if (loadError && !existing) {
        return reply.code(400).send({ error: mapAccountDbError(loadError) });
      }

      if (!existing) {
        return reply.code(404).send({
          error:
            '계정 없음 — 연운3(:10003) 포스팅 계정이 huma_accounts에 없을 수 있습니다. SQL: scripts/migrations/v3_37_persona_yeonun_posting.sql 실행 후 계정관리에서 등록하세요.',
        });
      }

      if (
        !assertAccountMutateAccess(
          existing as {
            account_type: string;
            workspace?: string | null;
            shared_workspace?: string | null;
          },
          allowedWorkspaces,
        )
      ) {
        return reply.code(403).send({ error: '워크스페이스 접근 권한 없음' });
      }

      const accountId = String(existing.id);
      const persona = mergeBlogWritingPersonaField(existing.persona, text);
      const { data, error } = await supabase
        .from('huma_accounts')
        .update({ persona })
        .eq('id', accountId)
        .select('*')
        .single();

      if (error) {
        const msg = error.message ?? '';
        if (/persona|column|schema cache/i.test(msg)) {
          return reply.code(400).send({
            error: `persona 컬럼 오류 — v3_37_persona_yeonun_posting.sql 실행: ${mapAccountDbError(msg)}`,
          });
        }
        return reply.code(400).send({ error: mapAccountDbError(msg) });
      }
      return stripAccountSecret(data);
    } catch (err) {
      request.log.error(err, 'blog-persona patch failed');
      return reply.code(500).send({ error: (err as Error).message ?? '페르소나 저장 실패' });
    }
  });

  app.patch('/api/accounts/:id', { preHandler: authMiddleware }, async (request, reply) => {
    try {
    const { id } = request.params as { id: string };
    const body = request.body as Record<string, unknown>;
    const allowedWorkspaces = getWorkspaceFilter(request);
    let { data: existing, loadError } = await loadAccountRow(id);

    const bodyProxyPort = parseLookupProxyPort(body);

    if (!existing && bodyProxyPort != null) {
      const byPort = await findYeonunPostingByProxyPort(bodyProxyPort);
      existing = byPort.data;
      loadError = byPort.loadError;
    }

    if (loadError === 'INVALID_ID') {
      return reply.code(400).send({ error: '잘못된 계정 id' });
    }
    if (!existing) return reply.code(404).send({ error: '계정 없음' });
    if (
      !assertAccountMutateAccess(
        existing as {
          account_type: string;
          workspace?: string | null;
          shared_workspace?: string | null;
        },
        allowedWorkspaces,
      )
    ) {
      return reply.code(403).send({ error: '워크스페이스 접근 권한 없음' });
    }

    const accountId = String(existing.id);
    const accountType = (body.account_type as string | undefined) ?? (existing.account_type as string);
    const ws = (body.workspace as string | undefined) ?? (existing.workspace as string);
    const patch: Record<string, unknown> = {};

    if (typeof body.blog_writing_persona === 'string') {
      const text = body.blog_writing_persona.trim();
      if (!text) {
        return reply.code(400).send({ error: '블로그 문체 지침이 비어 있습니다' });
      }
      patch.persona = mergeBlogWritingPersonaField(existing.persona, text);
    } else if (body.persona !== undefined) {
      if (body.persona !== null && (typeof body.persona !== 'object' || Array.isArray(body.persona))) {
        return reply.code(400).send({ error: 'persona는 JSON 객체여야 합니다' });
      }
      patch.persona = body.persona;
    }

    if (body.blog_url !== undefined) {
      const blogUrl = normalizeBlogUrl(body.blog_url);
      if (requiresPostingBlogUrl(accountType) && !blogUrl) {
        return reply.code(400).send({ error: POSTING_BLOG_URL_REQUIRED_MSG });
      }
      patch.blog_url = blogUrl;
    }

    if (body.is_active !== undefined) patch.is_active = body.is_active;
    if (typeof body.name === 'string') patch.name = body.name.trim();
    if (typeof body.naver_id === 'string') {
      const naverId = body.naver_id.trim();
      if (!naverId) {
        return reply.code(400).send({ error: '네이버 ID는 비울 수 없습니다' });
      }
      patch.naver_id = naverId;
    }
    if (body.wpm !== undefined) patch.wpm = body.wpm;
    if (body.health_score !== undefined) patch.health_score = body.health_score;
    if (body.blog_index !== undefined) patch.blog_index = body.blog_index;
    if (body.account_type !== undefined) patch.account_type = body.account_type;
    if (body.workspace !== undefined) patch.workspace = body.workspace;

    if (body.naver_pw && typeof body.naver_pw === 'string') {
      patch.naver_pw_enc = encrypt(body.naver_pw);
    }

    if (body.proxy_port !== undefined && accountType === 'posting' && !isPersonaOnlyPatch(body, patch)) {
      try {
        assertPostingProxyPortMatchesWorkspace(ws, body.proxy_port as number);
        await assertDongleCapacity(body.proxy_port as number, accountId);
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
      patch.proxy_port = body.proxy_port;
    }

    if (Object.keys(patch).length === 0) {
      return reply.code(400).send({ error: '변경할 필드가 없습니다' });
    }

    const { data, error } = await supabase
      .from('huma_accounts')
      .update(patch)
      .eq('id', accountId)
      .select('*')
      .single();
    if (error) {
      const msg = error.message ?? '';
      if (/persona|column|schema cache/i.test(msg)) {
        return reply.code(400).send({
          error: `persona 컬럼 없음 — Supabase에서 v3_37_persona_yeonun_posting.sql 실행: ${msg}`,
        });
      }
      return reply.code(400).send({ error: mapAccountDbError(msg) });
    }
    if (!data) return reply.code(404).send({ error: '계정 업데이트 실패' });
    if (patch.blog_url !== undefined) {
      const { clearBlogPostListCacheForAccount } = await import('../modules/blog-check/blog-post-list.js');
      await clearBlogPostListCacheForAccount(accountId);
    }
    return stripAccountSecret(data);
    } catch (err) {
      request.log.error(err, 'account patch failed');
      return reply.code(500).send({ error: (err as Error).message ?? '계정 수정 실패' });
    }
  });

  app.delete('/api/accounts/:id', { preHandler: authMiddleware }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const allowedWorkspaces = getWorkspaceFilter(request);
    const { data: existing, loadError } = await loadAccountRow(id);
    if (loadError === 'INVALID_ID') {
      return reply.code(400).send({ error: '잘못된 계정 id' });
    }
    if (!existing) return reply.code(404).send({ error: '계정 없음' });
    if (!assertAccountMutateAccess(existing as { account_type: string }, allowedWorkspaces)) {
      return reply.code(403).send({ error: '워크스페이스 접근 권한 없음' });
    }
    const deleted = await deleteAccountById(id);
    if (!deleted.ok) {
      return reply.code(400).send({ error: mapAccountDbError(deleted.error) });
    }
    return { success: true };
  });

  app.post('/api/accounts/:id/remote-access', { preHandler: authMiddleware }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const allowedWorkspaces = getWorkspaceFilter(request);
    const { data: existing, loadError } = await loadAccountRow(id);
    if (loadError === 'INVALID_ID') {
      return reply.code(400).send({ error: '잘못된 계정 id' });
    }
    if (!existing) return reply.code(404).send({ error: '계정 없음' });
    if (!assertAccountMutateAccess(existing as { account_type: string }, allowedWorkspaces)) {
      return reply.code(403).send({ error: '워크스페이스 접근 권한 없음' });
    }

    try {
      const { startPostingRemoteAccess } = await import('../lib/posting-remote-access.js');
      return await startPostingRemoteAccess(id);
    } catch (err) {
      const msg = (err as Error).message ?? '원격접속 실패';
      if (msg === 'ACCOUNT_BUSY') {
        return reply.code(409).send({ error: '계정이 다른 작업(발행·원격접속)에 사용 중입니다' });
      }
      if (msg === 'MODEM_BUSY' || msg === 'NO_IDLE_MODEM') {
        return reply.code(409).send({ error: '동글이 다른 작업에 사용 중입니다' });
      }
      if (msg === 'POSTING_ACCOUNT_ONLY') {
        return reply.code(400).send({ error: '포스팅 계정만 원격접속할 수 있습니다' });
      }
      if (msg === 'ACCOUNT_INACTIVE') {
        return reply.code(400).send({ error: '정지된 계정은 원격접속할 수 없습니다' });
      }
      if (msg === 'PROXY_PORT_MISSING') {
        return reply.code(400).send({ error: '프록시 포트가 설정되지 않았습니다' });
      }
      request.log.error(err, 'posting remote access failed');
      return reply.code(500).send({ error: msg });
    }
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
