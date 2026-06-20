import type { FastifyInstance } from 'fastify';
import { createReadStream, existsSync } from 'fs';
import { authMiddleware, getWorkspaceFilter, supabase } from '../middleware/auth.js';
import { mapAccountDbError } from '../lib/account-errors.js';
import { enqueueJob } from '../modules/queue/producer.js';
import {
  getCharacterAppearanceCounts,
  getLastSyncTime,
  listActivePananaCharacters,
  syncPananaCharacters,
} from '../modules/video-content/panana-characters.js';
import type { Workspace } from '@huma/shared';

async function assertAccountAccess(
  accountId: string,
  allowed: string[],
): Promise<{ ok: true; workspace: string } | { ok: false; status: number; error: string }> {
  const { data } = await supabase
    .from('huma_accounts')
    .select('workspace')
    .eq('id', accountId)
    .maybeSingle();
  if (!data) return { ok: false, status: 404, error: '계정 없음' };
  if (!allowed.includes(data.workspace)) {
    return { ok: false, status: 403, error: '워크스페이스 접근 권한 없음' };
  }
  return { ok: true, workspace: data.workspace };
}

export async function registerVideoContentRoutes(app: FastifyInstance) {
  app.get('/api/video-content', { preHandler: authMiddleware }, async (request) => {
    const allowed = getWorkspaceFilter(request);
    const { account_id, workspace } = request.query as { account_id?: string; workspace?: string };

    let query = supabase
      .from('huma_video_content_history')
      .select(
        'id, account_id, workspace, status, relationship_axis, emotion_curve, hook_type, cut_type, duration, scenario_summary, similarity_score, character_used, caption_youtube, caption_tiktok, caption_instagram, caption_threads, caption_x, first_comment_threads, first_comment_x, uploaded_youtube, uploaded_youtube_at, uploaded_tiktok, uploaded_tiktok_at, uploaded_instagram, uploaded_instagram_at, uploaded_threads, uploaded_threads_at, uploaded_x, uploaded_x_at, video_file_path, error_message, created_at',
      )
      .in('workspace', allowed)
      .order('created_at', { ascending: false })
      .limit(100);

    if (account_id) query = query.eq('account_id', account_id);
    if (workspace && allowed.includes(workspace)) query = query.eq('workspace', workspace);

    const { data } = await query;
    return data ?? [];
  });

  app.get('/api/video-content/:id', { preHandler: authMiddleware }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const allowed = getWorkspaceFilter(request);
    const { data } = await supabase
      .from('huma_video_content_history')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (!data) return reply.code(404).send({ error: '없음' });
    if (!allowed.includes(data.workspace)) return reply.code(403).send({ error: '권한 없음' });
    return data;
  });

  app.get('/api/video-content/:id/stream', { preHandler: authMiddleware }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const allowed = getWorkspaceFilter(request);
    const { data } = await supabase
      .from('huma_video_content_history')
      .select('workspace, video_file_path, status')
      .eq('id', id)
      .maybeSingle();
    if (!data?.video_file_path) return reply.code(404).send({ error: '영상 없음' });
    if (!allowed.includes(data.workspace)) return reply.code(403).send({ error: '권한 없음' });
    if (!existsSync(data.video_file_path)) return reply.code(404).send({ error: '파일 없음' });

    reply.header('Content-Type', 'video/mp4');
    return reply.send(createReadStream(data.video_file_path));
  });

  app.get('/api/video-content/:id/download', { preHandler: authMiddleware }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const allowed = getWorkspaceFilter(request);
    const { data } = await supabase
      .from('huma_video_content_history')
      .select('workspace, video_file_path')
      .eq('id', id)
      .maybeSingle();
    if (!data?.video_file_path || !existsSync(data.video_file_path)) {
      return reply.code(404).send({ error: '파일 없음' });
    }
    if (!allowed.includes(data.workspace)) return reply.code(403).send({ error: '권한 없음' });

    reply.header('Content-Type', 'video/mp4');
    reply.header('Content-Disposition', `attachment; filename="huma-video-${id}.mp4"`);
    return reply.send(createReadStream(data.video_file_path));
  });

  app.patch('/api/video-content/:id', { preHandler: authMiddleware }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const allowed = getWorkspaceFilter(request);
    const { data: existing } = await supabase
      .from('huma_video_content_history')
      .select('workspace')
      .eq('id', id)
      .maybeSingle();
    if (!existing) return reply.code(404).send({ error: '없음' });
    if (!allowed.includes(existing.workspace)) return reply.code(403).send({ error: '권한 없음' });

    const body = request.body as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    const platforms = ['youtube', 'tiktok', 'instagram', 'threads', 'x'] as const;

    for (const p of platforms) {
      const key = `uploaded_${p}`;
      if (body[key] !== undefined) {
        patch[key] = Boolean(body[key]);
        patch[`${key}_at`] = body[key] ? new Date().toISOString() : null;
      }
    }

    const { data, error } = await supabase
      .from('huma_video_content_history')
      .update(patch)
      .eq('id', id)
      .select()
      .single();
    if (error) return reply.code(400).send({ error: error.message });
    return data;
  });

  app.get('/api/accounts/:id/video-content-history', { preHandler: authMiddleware }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const access = await assertAccountAccess(id, getWorkspaceFilter(request));
    if (!access.ok) return reply.code(access.status).send({ error: access.error });

    const { data } = await supabase
      .from('huma_video_content_history')
      .select(
        'id, scenario_summary, similarity_score, cut_type, duration, relationship_axis, emotion_curve, hook_type, status, created_at',
      )
      .eq('account_id', id)
      .order('created_at', { ascending: false })
      .limit(10);
    return data ?? [];
  });

  app.post('/api/accounts/:id/generate-video', { preHandler: authMiddleware }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const access = await assertAccountAccess(id, getWorkspaceFilter(request));
    if (!access.ok) return reply.code(access.status).send({ error: access.error });

    const { data: generating } = await supabase
      .from('huma_video_content_history')
      .select('id')
      .eq('account_id', id)
      .eq('status', 'generating')
      .limit(1);
    if (generating?.length) {
      return reply.code(409).send({ error: '이미 생성 중인 영상이 있습니다' });
    }

    await enqueueJob({
      type: 'video_content_generate',
      payload: { accountId: id },
    });

    return { ok: true, message: '영상 생성 작업이 큐에 등록되었습니다' };
  });

  app.get('/api/panana-characters', { preHandler: authMiddleware }, async (request) => {
    const allowed = getWorkspaceFilter(request);
    if (!allowed.includes('panana')) return [];
    const chars = await listActivePananaCharacters();
    const { account_id } = request.query as { account_id?: string };
    let counts = new Map<string, number>();
    if (account_id) counts = await getCharacterAppearanceCounts(account_id);
    const lastSync = await getLastSyncTime();
    return {
      characters: chars.map((c) => ({
        ...c,
        appearanceCount: counts.get(c.id) ?? 0,
      })),
      lastSyncedAt: lastSync,
    };
  });

  app.post('/api/panana-characters/sync', { preHandler: authMiddleware }, async (request, reply) => {
    const allowed = getWorkspaceFilter(request);
    if (!allowed.includes('panana')) return reply.code(403).send({ error: '권한 없음' });
    const result = await syncPananaCharacters();
    if (result.error && result.synced === 0) return reply.code(502).send(result);
    return result;
  });

  /** EvoLink 작업 완료/실패 콜백 (인증 없음 — HTTPS 공개 URL) */
  app.post('/api/evolink/video-callback', async (request, reply) => {
    const body = request.body as {
      id?: string;
      status?: string;
      error?: { message?: string };
    };
    if (!body.id) return reply.code(400).send({ error: 'task id 없음' });

    if (body.status === 'failed') {
      const { data: rows } = await supabase
        .from('huma_video_content_history')
        .select('id, conti_json')
        .eq('status', 'generating');
      const row = (rows ?? []).find(
        (r) => (r.conti_json as Record<string, unknown> | null)?.evolinkTaskId === body.id,
      );
      if (row) {
        await supabase
          .from('huma_video_content_history')
          .update({
            status: 'failed',
            error_message: body.error?.message ?? 'EvoLink 생성 실패',
          })
          .eq('id', row.id);
      }
    }

    return { ok: true };
  });
}
