import type { FastifyInstance } from 'fastify';
import { authMiddleware, getWorkspaceFilter, supabase } from '../middleware/auth.js';

export async function registerVideoRoutes(app: FastifyInstance) {
  app.post('/api/video/generate', { preHandler: authMiddleware }, async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    const allowedWorkspaces = getWorkspaceFilter(request);
    if (body.workspace && !allowedWorkspaces.includes(body.workspace as string)) {
      return reply.code(403).send({ error: '워크스페이스 접근 권한 없음' });
    }
    const { data, error } = await supabase.from('huma_video_queue').insert(body).select().single();
    if (error) return reply.code(400).send({ error: error.message });

    if (data) {
      const { enqueueJob } = await import('../modules/queue/producer.js');
      await enqueueJob({
        type: 'video_pipeline',
        payload: { videoQueueId: data.id },
        humaJobId: data.job_id,
      });
    }
    return data;
  });

  app.get('/api/video/queue', { preHandler: authMiddleware }, async (request) => {
    const allowedWorkspaces = getWorkspaceFilter(request);
    const { data } = await supabase
      .from('huma_video_queue')
      .select('*')
      .in('workspace', allowedWorkspaces)
      .order('created_at', { ascending: false });
    return data ?? [];
  });
}
