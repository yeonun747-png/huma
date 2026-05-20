import type { FastifyInstance } from 'fastify';
import { authMiddleware, supabase } from '../middleware/auth.js';
import { updateSetting } from '../lib/settings.js';

export async function registerSettingsRoutes(app: FastifyInstance) {
  app.get('/api/settings/:key', { preHandler: authMiddleware }, async (request) => {
    const { key } = request.params as { key: string };
    const { data } = await supabase.from('huma_settings').select('value').eq('key', key).single();
    return data?.value ?? {};
  });

  app.put('/api/settings/:key', { preHandler: authMiddleware }, async (request) => {
    const { key } = request.params as { key: string };
    const value = request.body;
    await updateSetting(key, value);
    return { success: true, key, value };
  });

  app.get('/api/settings', { preHandler: authMiddleware }, async () => {
    const { data } = await supabase.from('huma_settings').select('*');
    return data ?? [];
  });
}
