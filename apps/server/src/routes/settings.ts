import type { FastifyInstance } from 'fastify';
import { authMiddleware, getWorkspaceFilter, supabase } from '../middleware/auth.js';
import { updateSetting } from '../lib/settings.js';
import { setActivityControl, type ActivityControlState } from '../lib/activity-control.js';
import { fetchPostingWarmupStatus } from '../lib/posting-warmup-status.js';
import { listPostingAccountsByDongle } from '../lib/posting-accounts.js';

// 전역 운영에 영향을 주는 민감 설정 키 — 슈퍼관리자만 변경 가능
const SUPER_ONLY_SETTING_KEYS = new Set([
  'human_engine',
  'social_crank',
  'system_paused',
  'activity_control',
  'image_engine',
  'cafe_viral',
]);

export async function registerSettingsRoutes(app: FastifyInstance) {
  app.get('/api/settings/:key', { preHandler: authMiddleware }, async (request) => {
    const { key } = request.params as { key: string };
    const { data } = await supabase.from('huma_settings').select('value').eq('key', key).single();
    return data?.value ?? {};
  });

  app.put('/api/settings/:key', { preHandler: authMiddleware }, async (request, reply) => {
    const { key } = request.params as { key: string };
    if (SUPER_ONLY_SETTING_KEYS.has(key) && !request.admin?.isSuper) {
      return reply.code(403).send({ error: '이 설정은 슈퍼관리자만 변경할 수 있습니다' });
    }
    const value = request.body;
    await updateSetting(key, value);
    if (key === 'activity_control' && value && typeof value === 'object') {
      await setActivityControl(value as Partial<ActivityControlState>);
    }
    return { success: true, key, value };
  });

  app.get('/api/settings', { preHandler: authMiddleware }, async () => {
    const { data } = await supabase.from('huma_settings').select('*');
    return data ?? [];
  });

  app.get('/api/posting/warmup-status', { preHandler: authMiddleware }, async (request, reply) => {
    try {
      const allowedWorkspaces = getWorkspaceFilter(request);
      const accounts = await fetchPostingWarmupStatus(allowedWorkspaces);
      return {
        accounts,
        is_super: Boolean(request.admin?.isSuper),
      };
    } catch (err) {
      return reply.code(500).send({ error: (err as Error).message ?? '워밍업 현황 조회 실패' });
    }
  });

  app.get('/api/posting/accounts', { preHandler: authMiddleware }, async (request, reply) => {
    try {
      const { workspace } = request.query as { workspace?: string };
      const allowedWorkspaces = getWorkspaceFilter(request);
      if (!workspace || !allowedWorkspaces.includes(workspace)) {
        return reply.code(403).send({ error: '워크스페이스 접근 권한 없음' });
      }
      const { listPostingAccounts } = await import('../lib/posting-accounts.js');
      const accounts = await listPostingAccounts(workspace);
      return { accounts };
    } catch (err) {
      return reply.code(500).send({ error: (err as Error).message ?? '포스팅 계정 조회 실패' });
    }
  });

  app.get('/api/posting/dongles', { preHandler: authMiddleware }, async (request, reply) => {
    try {
      const { workspace } = request.query as { workspace?: string };
      const allowedWorkspaces = getWorkspaceFilter(request);
      const targets = workspace
        ? allowedWorkspaces.includes(workspace)
          ? [workspace]
          : []
        : allowedWorkspaces;
      const dongles = (
        await Promise.all(targets.map((ws) => listPostingAccountsByDongle(ws)))
      ).flat();
      return { dongles };
    } catch (err) {
      return reply.code(500).send({ error: (err as Error).message ?? '동글 현황 조회 실패' });
    }
  });
}
