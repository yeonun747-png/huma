import type { FastifyInstance } from 'fastify';
import { authMiddleware, supabase, getWorkspaceFilter } from '../middleware/auth.js';
import { createBrowser, createBrowserForAccount, closeBrowserContext } from '../modules/playwright/browser.js';
import { pickCafeReplyCrankAccount, pickCafeScanAccount } from '../lib/cafe-accounts.js';
import {
  assertCafeViralReplyLimits,
  assertCafeViralYeonunWorkspace,
  assertCafeWarmupComplete,
  normalizeCafePostUrl,
} from '../lib/cafe-viral-config.js';
import { scanCafeById } from '../modules/cafe/viral.js';
import { autoDetectGradeRequirements, executeViralReplyPost, runCafeWarmup } from '../modules/cafe/warmup.js';
import { runDailyActivity, getTodayActivityCounts, assertActivityRatioSlot } from '../modules/cafe/activity.js';
import { generateViralReply } from '../modules/cafe/viral.js';
import { loadAccountForBrowser } from '../modules/playwright/account-loader.js';
import { naverLogin } from '../modules/playwright/naver/login.js';

export async function registerCafeViralRoutes(app: FastifyInstance) {
  app.get('/api/cafe-viral/cafes', { preHandler: authMiddleware }, async (request) => {
    const workspaces = getWorkspaceFilter(request).filter((ws) => ws === 'yeonun');
    if (!workspaces.length) return [];
    const { data } = await supabase
      .from('huma_cafe_viral_cafes')
      .select('*')
      .eq('workspace', 'yeonun')
      .order('created_at', { ascending: false });
    return data ?? [];
  });

  app.post('/api/cafe-viral/cafes', { preHandler: authMiddleware }, async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    const workspace = String(body.workspace ?? 'yeonun');
    try {
      assertCafeViralYeonunWorkspace(workspace);
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
    const workspaces = getWorkspaceFilter(request);
    if (!workspaces.includes('yeonun')) {
      return reply.code(403).send({ error: '연운 워크스페이스 접근 권한 없음' });
    }

    const cafeUrl = String(body.cafe_url ?? '').replace(/^https?:\/\/cafe\.naver\.com\//, '').split('/')[0];
    const { data, error } = await supabase
      .from('huma_cafe_viral_cafes')
      .insert({
        workspace: 'yeonun',
        cafe_url: cafeUrl,
        cafe_name: String(body.cafe_name ?? cafeUrl),
        category: body.category ? String(body.category) : null,
        keywords: (body.keywords as string[]) ?? [],
        grade_requirements: body.grade_requirements ?? null,
        activity_ratio: body.activity_ratio ?? { daily_reply: 8, self_qa: 2 },
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
        ...(body.grade_auto_detected !== undefined ? { grade_auto_detected: Boolean(body.grade_auto_detected) } : {}),
        ...(body.activity_ratio !== undefined ? { activity_ratio: body.activity_ratio } : {}),
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

  app.post('/api/cafe-viral/cafes/:id/scan', { preHandler: authMiddleware }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { account_id?: string };

    try {
      const accountId = body.account_id ?? (await pickCafeScanAccount());
      if (!accountId) {
        return reply.code(400).send({
          error:
            '비공개 카페 스캔에는 네이버 계정이 필요합니다. 계정관리에서 C-Rank·카페·포스팅 계정을 등록하고 럭키포에버(raise1)에 가입하세요.',
        });
      }

      const accountCtx = await loadAccountForBrowser(accountId);
      const { context } = await createBrowserForAccount(accountCtx);
      try {
        await naverLogin(context, accountId);
        const page = await context.newPage();
        const count = await scanCafeById(id, page);
        return { success: true, count };
      } finally {
        await closeBrowserContext(context);
      }
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.get('/api/cafe-viral/posts', { preHandler: authMiddleware }, async (request) => {
    const workspaces = getWorkspaceFilter(request);
    if (!workspaces.includes('yeonun')) return [];
    const { status } = request.query as { status?: string };
    let query = supabase
      .from('huma_cafe_viral_posts')
      .select('*, huma_cafe_viral_cafes(cafe_name, cafe_url)')
      .eq('workspace', 'yeonun')
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
    await assertActivityRatioSlot(post.cafe_id, post.is_self_post ? 'self_qa' : 'daily_reply');
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

  app.post('/api/cafe-viral/activity/daily', { preHandler: authMiddleware }, async (request, reply) => {
    const body = request.body as { account_id: string; cafe_id: string; workspace: string };
    if (!body.account_id || !body.cafe_id || !body.workspace) {
      return reply.code(400).send({ error: 'account_id, cafe_id, workspace 필요' });
    }

    await assertCafeWarmupComplete(body.account_id, body.cafe_id);

    const accountCtx = await loadAccountForBrowser(body.account_id);
    const { browser, context } = await createBrowser(accountCtx?.proxy_port);
    try {
      await naverLogin(context, body.account_id);
      const page = await context.newPage();
      const result = await runDailyActivity({
        accountId: body.account_id,
        cafeId: body.cafe_id,
        workspace: body.workspace,
        page,
      });
      return { success: true, ...result };
    } finally {
      await browser.close();
    }
  });

  app.get('/api/cafe-viral/activity/stats', { preHandler: authMiddleware }, async (request) => {
    const { cafe_id } = request.query as { cafe_id?: string };
    if (!cafe_id) return { error: 'cafe_id 필요' };
    const counts = await getTodayActivityCounts(cafe_id);
    const { data: cafe } = await supabase.from('huma_cafe_viral_cafes').select('activity_ratio, cafe_name').eq('id', cafe_id).single();
    return { cafe_name: cafe?.cafe_name, activity_ratio: cafe?.activity_ratio ?? { daily_reply: 8, self_qa: 2 }, today: counts };
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
