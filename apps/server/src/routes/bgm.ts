import type { FastifyInstance } from 'fastify';
import { authMiddleware, supabase } from '../middleware/auth.js';

export async function registerBgmRoutes(app: FastifyInstance) {
  app.get('/api/bgm', { preHandler: authMiddleware }, async (request) => {
    const { workspace, mood } = request.query as { workspace?: string; mood?: string };
    let query = supabase.from('huma_bgm_library').select('*').order('use_count', { ascending: true });
    if (workspace) query = query.contains('workspace_fit', [workspace]);
    if (mood) query = query.contains('mood', [mood]);
    const { data } = await query;
    return data ?? [];
  });

  app.post('/api/bgm', { preHandler: authMiddleware }, async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    const { data, error } = await supabase.from('huma_bgm_library').insert(body).select().single();
    if (error) return reply.code(400).send({ error: error.message });
    return data;
  });

  app.get('/api/bgm/select', { preHandler: authMiddleware }, async (request) => {
    const { workspace, mood, platform } = request.query as {
      workspace?: string;
      mood?: string;
      platform?: string;
    };
    let query = supabase.from('huma_bgm_library').select('id, file_url, use_count').limit(5);
    if (mood) query = query.contains('mood', [mood]);
    if (workspace) query = query.contains('workspace_fit', [workspace]);
    if (platform) query = query.contains('platform_fit', [platform]);
    const { data } = await query;
    if (!data?.length) return { file_url: null };
    const selected = data[Math.floor(Math.random() * data.length)];
    return { file_url: selected.file_url, id: selected.id };
  });
}
