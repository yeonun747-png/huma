import type { FastifyInstance } from 'fastify';
import { authMiddleware, supabase, getWorkspaceFilter } from '../middleware/auth.js';
import { createBrowser } from '../modules/playwright/browser.js';
import { pickCafeReplyCrankAccount } from '../lib/cafe-accounts.js';
import {
  assertCafeViralReplyLimits,
  assertCafeWarmupComplete,
  normalizeCafePostUrl,
} from '../lib/cafe-viral-config.js';
import { scanCafeById } from '../modules/cafe/viral.js';
import { autoDetectGradeRequirements, executeViralReplyPost, runCafeWarmup } from '../modules/cafe/warmup.js';
import { generateViralReply } from '../modules/cafe/viral.js';
import { loadAccountForBrowser } from '../modules/playwright/account-loader.js';
import { naverLogin } from '../modules/playwright/naver/login.js';

export async function registerCafeViralRoutes(app: FastifyInstance) {
  app.get('/api/cafe-viral/cafes', { preHandler: authMiddleware }, async (request) => {
    const workspaces = getWorkspaceFilter(request);
    const { data } = await supabase
      .from('huma_cafe_viral_cafes')
      .select('*')
      .in('workspace', workspaces)
      .order('created_at', { ascending: false });
    return data ?? [];
  });

  app.post('/api/cafe-viral/cafes', { preHandler: authMiddleware }, async (request) => {
    const body = request.body as Record<string, unknown>;
    const workspaces = getWorkspaceFilter(request);
    const workspace = String(body.workspace ?? '');
    if (!workspaces.includes(workspace)) {
      return { error: '워크스페이스 접근 권한 없음' };
    }

    const cafeUrl = String(body.cafe_url ?? '').replace(/^https?:\/\/cafe\.naver\.com\//, '').split('/')[0];
    const { data, error } = await supabase
      .from('huma_cafe_viral_cafes')
      .insert({
        workspace,
        cafe_url: cafeUrl,
        cafe_name: String(body.cafe_name ?? cafeUrl),
        category: body.category ? String(body.category) : null,
        keywords: (body.keywords as string[]) ?? [],
        grade_requirements: body.grade_requirements ?? null,
        note: body.note ? String(body.note) : null,
        is_active: body.is_active !== false,
      })
      .select()
      .single();

    if (error) return { error: error.message };
    return data;
  });

  app.patch('/api/cafe-viral/cafes/:id', { preHandler: authMiddleware }, async (request) => {
    const { id } = request.params as { id: string };
    const body = request.body as Record<string, unknown>;
    const { data, error } = await supabase
      .from('huma_cafe_viral_cafes')
      .update({
        ...(body.cafe_name !== undefined ? { cafe_name: String(body.cafe_name) } : {}),
        ...(body.category !== undefined ? { category: String(body.category) } : {}),
        ...(body.keywords !== undefined ? { keywords: body.keywords as string[] } : {}),
        ...(body.grade_requirements !== undefined ? { grade_requirements: body.grade_requirements } : {}),
        ...(body.is_active !== undefined ? { is_active: Boolean(body.is_active) } : {}),
        ...(body.note !== undefined ? { note: String(body.note) } : {}),
      })
      .eq('id', id)
      .select()
      .single();
    if (error) return { error: error.message };
    return data;
  });

  app.post('/api/cafe-viral/cafes/:id/detect-grade', { preHandler: authMiddleware }, async (request) => {
    const { id } = request.params as { id: string };
    const { data: cafe } = await supabase.from('huma_cafe_viral_cafes').select('*').eq('id', id).single();
    if (!cafe) return { error: '카페 없음' };

    const slug = String(cafe.cafe_url).split('/')[0];
    const { browser, context } = await createBrowser();
    try {
      const page = await context.newPage();
      const requirements = await autoDetectGradeRequirements(slug, page);
      if (!requirements) return { error: '등업 조건 자동 감지 실패 — 수동 입력 필요' };

      await supabase
        .from('huma_cafe_viral_cafes')
        .update({
          grade_requirements: requirements,
          grade_auto_detected: true,
          grade_detected_at: new Date().toISOString(),
        })
        .eq('id', id);

      return { success: true, grade_requirements: requirements };
    } finally {
      await browser.close();
    }
  });

  app.post('/api/cafe-viral/cafes/:id/scan', { preHandler: authMiddleware }, async (request) => {
    const { id } = request.params as { id: string };
    const { browser, context } = await createBrowser();
    try {
      const page = await context.newPage();
      const count = await scanCafeById(id, page);
      return { success: true, count };
    } finally {
      await browser.close();
    }
  });

  app.get('/api/cafe-viral/posts', { preHandler: authMiddleware }, async (request) => {
    const workspaces = getWorkspaceFilter(request);
    const { status } = request.query as { status?: string };
    let query = supabase
      .from('huma_cafe_viral_posts')
      .select('*, huma_cafe_viral_cafes(cafe_name, cafe_url)')
      .in('workspace', workspaces)
      .order('created_at', { ascending: false })
      .limit(100);
    if (status) query = query.eq('status', status);
    const { data } = await query;
    return data ?? [];
  });

  app.post('/api/cafe-viral/posts/:id/draft', { preHandler: authMiddleware }, async (request) => {
    const { id } = request.params as { id: string };
    const { data: post } = await supabase.from('huma_cafe_viral_posts').select('*').eq('id', id).single();
    if (!post) return { error: '게시글 없음' };

    const reply = await generateViralReply({
      postTitle: post.post_title ?? '',
      workspace: post.workspace,
    });
    await supabase.from('huma_cafe_viral_posts').update({ reply_drafted: reply }).eq('id', id);
    return { success: true, reply_drafted: reply };
  });

  app.post('/api/cafe-viral/posts/:id/reply', { preHandler: authMiddleware }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { account_id?: string } | undefined;

    const { data: post } = await supabase.from('huma_cafe_viral_posts').select('*').eq('id', id).single();
    if (!post) return reply.code(404).send({ error: '게시글 없음' });

    await assertCafeViralReplyLimits(post.cafe_id);
    const accountId = body?.account_id ?? (await pickCafeReplyCrankAccount());
    if (!accountId) return reply.code(400).send({ error: '사용 가능한 C-Rank 계정 없음' });

    await assertCafeWarmupComplete(accountId, post.cafe_id);

    const accountCtx = await loadAccountForBrowser(accountId);
    const { browser, context } = await createBrowser(accountCtx?.proxy_port);
    try {
      await naverLogin(context, accountId);
      const page = await context.newPage();
      await executeViralReplyPost({ postId: id, accountId, page });
      return { success: true, post_url: normalizeCafePostUrl(post.post_url) };
    } finally {
      await browser.close();
    }
  });

  app.post('/api/cafe-viral/warmup', { preHandler: authMiddleware }, async (request, reply) => {
    const body = request.body as { account_id: string; cafe_id: string };
    if (!body.account_id || !body.cafe_id) {
      return reply.code(400).send({ error: 'account_id, cafe_id 필요' });
    }

    const accountCtx = await loadAccountForBrowser(body.account_id);
    const { browser, context } = await createBrowser(accountCtx?.proxy_port);
    try {
      await naverLogin(context, body.account_id);
      const page = await context.newPage();
      await runCafeWarmup({ accountId: body.account_id, cafeId: body.cafe_id, page });
      return { success: true };
    } finally {
      await browser.close();
    }
  });

  app.get('/api/cafe-viral/warmup', { preHandler: authMiddleware }, async (request) => {
    const workspaces = getWorkspaceFilter(request);
    const { data } = await supabase
      .from('huma_cafe_warmup_accounts')
      .select('*, huma_accounts(name), huma_cafe_viral_cafes(cafe_name, workspace)')
      .order('created_at', { ascending: false });
    return (data ?? []).filter((row) => {
      const ws = (row as { huma_cafe_viral_cafes?: { workspace?: string } }).huma_cafe_viral_cafes?.workspace;
      return !ws || workspaces.includes(ws);
    });
  });
}
