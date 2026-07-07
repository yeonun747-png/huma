import type { FastifyRequest, FastifyReply } from 'fastify';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getJwtSecret } from '../lib/secrets.js';

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
    getJwtSecret(),
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
    const payload = jwt.verify(token, getJwtSecret()) as AdminPayload;
    request.admin = payload;
  } catch {
    return reply.code(401).send({ error: '토큰 만료 또는 무효' });
  }
}

/** 토큰 문자열(JWT 또는 HUMA_API_SECRET)을 검증해 AdminPayload 반환, 실패 시 null. WebSocket 등 미들웨어 외 경로용. */
export function verifyAdminToken(token: string | undefined): AdminPayload | null {
  if (!token) return null;
  const apiSecret = process.env.HUMA_API_SECRET?.trim();
  if (apiSecret && token === apiSecret) {
    return {
      adminId: 'system',
      email: 'superadmin',
      workspaces: ['yeonun', 'quizoasis', 'panana'],
      isSuper: true,
    };
  }
  try {
    return jwt.verify(token, getJwtSecret()) as AdminPayload;
  } catch {
    return null;
  }
}

export function getWorkspaceFilter(request: FastifyRequest): string[] {
  const admin = request.admin!;
  return admin.isSuper
    ? ['yeonun', 'quizoasis', 'panana', 'fortune82']
    : admin.workspaces;
}

/** 슈퍼관리자 전용 라우트 가드 (인프라 제어 등). authMiddleware 이후에 둔다. */
export function requireSuper(request: FastifyRequest, reply: FastifyReply, done: () => void) {
  if (!request.admin?.isSuper) {
    reply.code(403).send({ error: '슈퍼관리자 권한이 필요합니다' });
    return;
  }
  done();
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
