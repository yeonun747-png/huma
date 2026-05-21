import type { FastifyInstance } from 'fastify';
import { authMiddleware, supabase } from '../middleware/auth.js';
import { enqueueJob } from '../modules/queue/producer.js';
import { crawlCafeTargets } from '../modules/playwright/naver/cafe-crawl.js';
import { pickCafeReplyCrankAccount } from '../lib/cafe-accounts.js';
export async function registerCafeRoutes(app: FastifyInstance) {
  app.get('/api/cafe/targets', { preHandler: authMiddleware }, async (request) => {
    const { replied } = request.query as { replied?: string };
    let query = supabase.from('huma_cafe_targets').select('*').order('created_at', { ascending: false });
    if (replied === 'false') query = query.eq('is_replied', false);
    const { data } = await query;
    return data ?? [];
  });

  app.post('/api/cafe/crawl', { preHandler: authMiddleware }, async () => {
    const count = await crawlCafeTargets();
    return { success: true, message: '크롤링 완료', count };
  });

  app.post('/api/cafe/reply/:id', { preHandler: authMiddleware }, async (request) => {
    const { id } = request.params as { id: string };
    const { data: target } = await supabase.from('huma_cafe_targets').select('*').eq('id', id).single();
    if (!target) return { error: '대상 없음' };

    const crankAccountId = await pickCafeReplyCrankAccount();
    if (!crankAccountId) {
      return { error: '사용 가능한 C-Rank 계정 없음' };
    }

    await enqueueJob({
      type: 'cafe_reply',
      accountId: crankAccountId,
      payload: { postUrl: target.post_url, replyContent: target.reply_content || '좋은 글 감사합니다!' },
    });
    return { success: true, targetId: id };
  });
}
