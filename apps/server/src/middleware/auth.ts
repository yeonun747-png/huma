import type { FastifyRequest, FastifyReply } from 'fastify';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export interface AdminPayload {
  adminId: string;
  email?: string;
  workspaces: string[];
  isSuper: boolean;
}

declare module 'fastify' {
  interface FastifyRequest {
    admin?: AdminPayload;
  }
}

let supabaseClient: SupabaseClient | null = null;
let cachedKey = '';

function getSupabase(): SupabaseClient {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_KEY?.trim();
  if (!url || !key) {
    throw new Error('Supabase 미설정 — apps/server/.env에 SUPABASE_URL, SUPABASE_SERVICE_KEY 입력');
  }
  if (!supabaseClient || cachedKey !== key) {
    supabaseClient = createClient(url, key);
    cachedKey = key;
  }
  return supabaseClient;
}

export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    const client = getSupabase();
    const value = client[prop as keyof SupabaseClient];
    if (typeof value === 'function') {
      return (value as (...args: unknown[]) => unknown).bind(client);
    }
    return value;
  },
});

export async function loginAdmin(loginId: string, password: string) {
  const supabase = getSupabase();
  const { data: admin, error } = await supabase
    .from('huma_admins')
    .select('*')
    .eq('email', loginId)
    .eq('is_active', true)
    .single();

  if (error || !admin) throw new Error('관리자 계정 없음');

  const valid = await bcrypt.compare(password, admin.pw_hash);
  if (!valid) throw new Error('비밀번호 불일치');

  await supabase
    .from('huma_admins')
    .update({ last_login_at: new Date().toISOString() })
    .eq('id', admin.id);

  const expiresIn = (process.env.JWT_EXPIRES_IN || '8h') as jwt.SignOptions['expiresIn'];
  const token = jwt.sign(
    {
      adminId: admin.id,
      email: admin.email,
      workspaces: admin.workspaces,
      isSuper: admin.is_super,
    },
    process.env.JWT_SECRET ?? 'dev-secret',
    { expiresIn }
  );

  return {
    token,
    admin: {
      name: admin.name,
      email: admin.email,
      workspaces: admin.workspaces,
      isSuper: admin.is_super,
    },
  };
}

export async function authMiddleware(request: FastifyRequest, reply: FastifyReply) {
  const token = request.headers['x-huma-key'] as string | undefined;
  if (!token) {
    return reply.code(401).send({ error: '인증 필요' });
  }

  const apiSecret = process.env.HUMA_API_SECRET?.trim();
  if (apiSecret && token === apiSecret) {
    request.admin = {
      adminId: 'system',
      email: 'superadmin',
      workspaces: ['yeonun', 'quizoasis', 'panana'],
      isSuper: true,
    };
    return;
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET ?? 'dev-secret') as AdminPayload;
    request.admin = payload;
  } catch {
    return reply.code(401).send({ error: '토큰 만료 또는 무효' });
  }
}

export function getWorkspaceFilter(request: FastifyRequest): string[] {
  const admin = request.admin!;
  return admin.isSuper ? ['yeonun', 'quizoasis', 'panana'] : admin.workspaces;
}

export function requireWorkspace(workspace: string) {
  return (request: FastifyRequest, reply: FastifyReply, done: () => void) => {
    const admin = request.admin;
    if (!admin?.isSuper && !admin?.workspaces.includes(workspace)) {
      reply.code(403).send({ error: '워크스페이스 접근 권한 없음' });
      return;
    }
    done();
  };
}

export { getSupabase };
