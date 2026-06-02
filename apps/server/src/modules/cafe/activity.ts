import type { Page } from 'playwright';
import { supabase } from '../../middleware/auth.js';
import {
  getCafeViralConfig,
  resolveActivityRatio,
} from '../../lib/cafe-viral-config.js';
import { FREE_BOARD_PATTERN, findCafeBoardMenuId, resolveCafeClubId } from '../../lib/cafe-nav.js';
import { randomBetween, sleep } from '../../lib/utils.js';
import {
  generateSelfQuestion,
  pickRandomProductTopic,
  postViralReply,
} from './viral.js';
import { generateCafeComment, generateCafeCommentFromPage } from './cafe-comment.js';
import { getHumanEngineConfig } from '../../lib/settings.js';
import { writeCafeReply, writeGenericCafePost } from '../playwright/naver/cafe.js';
import { logOperation } from '../../lib/log-emitter.js';
import { loadAccountForBrowser } from '../playwright/account-loader.js';
import type { AccountPersona } from '../playwright/persona.js';

function kstTodayStart(): string {
  const now = new Date();
  const kst = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  kst.setHours(0, 0, 0, 0);
  return new Date(kst.getTime() - 9 * 60 * 60 * 1000).toISOString();
}

export interface SelfQAMeta {
  kind: 'self_qa';
  phase: 'post' | 'reply';
  run_after?: string;
  account_id?: string;
  product_name?: string;
}

export function parseSelfQAMeta(raw: string | null | undefined): SelfQAMeta | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as SelfQAMeta;
    if (parsed.kind === 'self_qa' && (parsed.phase === 'post' || parsed.phase === 'reply')) {
      return parsed;
    }
  } catch {
    return null;
  }
  return null;
}

export async function getTodayActivityCounts(cafeId: string, accountId?: string): Promise<{
  daily_reply: number;
  self_qa: number;
}> {
  const since = kstTodayStart();
  let replyQuery = supabase
    .from('huma_cafe_viral_posts')
    .select('*', { count: 'exact', head: true })
    .eq('cafe_id', cafeId)
    .eq('status', 'posted')
    .eq('is_self_post', false)
    .gte('posted_at', since);
  let selfQuery = supabase
    .from('huma_cafe_viral_posts')
    .select('*', { count: 'exact', head: true })
    .eq('cafe_id', cafeId)
    .eq('status', 'posted')
    .eq('is_self_post', true)
    .gte('posted_at', since);

  if (accountId) {
    replyQuery = replyQuery.eq('account_id', accountId);
    selfQuery = selfQuery.eq('account_id', accountId);
  }

  const [{ count: daily_reply }, { count: self_qa }] = await Promise.all([replyQuery, selfQuery]);
  return { daily_reply: daily_reply ?? 0, self_qa: self_qa ?? 0 };
}

/** v3.17 ㉝ — 등업 후 80:20 비율 준수 */
export async function assertActivityRatioSlot(
  cafeId: string,
  kind: 'daily_reply' | 'self_qa',
): Promise<void> {
  const { data: cafe } = await supabase.from('huma_cafe_viral_cafes').select('activity_ratio').eq('id', cafeId).single();
  const config = await getCafeViralConfig();
  const ratio = resolveActivityRatio(cafe?.activity_ratio, config.activity_ratio);
  const counts = await getTodayActivityCounts(cafeId);
  const limit = kind === 'daily_reply' ? ratio.daily_reply : ratio.self_qa;
  const current = kind === 'daily_reply' ? counts.daily_reply : counts.self_qa;
  if (current >= limit) {
    throw new Error(`오늘 ${kind === 'daily_reply' ? '타인 답글' : '자문자답'} 한도 초과 (${current}/${limit})`);
  }
}

async function getRecentPostUrls(cafeSlug: string, page: Page, limit: number): Promise<Array<{ url: string; title: string }>> {
  await page.goto(`https://cafe.naver.com/${cafeSlug}`);
  await page.waitForLoadState('networkidle').catch(() => {});
  const links = await page.$$eval('a.article, .article-board .td_article a', (els) =>
    els
      .map((el) => ({
        title: (el as HTMLElement).textContent?.trim() ?? '',
        url: (el as HTMLAnchorElement).href ?? '',
      }))
      .filter((x) => x.url && x.title),
  );
  return links.slice(0, limit);
}

/** v3.17 7-9-0 — 하루 10개: 타인 답글 80% + 자문자답 20% */
export async function runDailyActivity(params: {
  accountId: string;
  cafeId: string;
  workspace: string;
  page: Page;
}): Promise<{ daily_reply: number; self_qa_scheduled: number }> {
  const { data: cafe } = await supabase.from('huma_cafe_viral_cafes').select('*').eq('id', params.cafeId).single();
  if (!cafe?.is_active) throw new Error('비활성 카페');

  const accountCtx = await loadAccountForBrowser(params.accountId);
  const persona = accountCtx.persona as AccountPersona;

  const config = await getCafeViralConfig();
  const ratio = resolveActivityRatio(cafe.activity_ratio, config.activity_ratio);
  const counts = await getTodayActivityCounts(params.cafeId, params.accountId);
  const slug = String(cafe.cafe_url).replace(/^https?:\/\/cafe\.naver\.com\//, '').split('/')[0];

  const replyTarget = Math.max(0, ratio.daily_reply - counts.daily_reply);
  const posts = replyTarget > 0 ? await getRecentPostUrls(slug, params.page, replyTarget * 2) : [];

  let replyDone = 0;
  const humanEngine = await getHumanEngineConfig();

  for (const post of posts) {
    if (replyDone >= replyTarget) break;
    await assertActivityRatioSlot(params.cafeId, 'daily_reply');

    await params.page.goto(post.url);
    await sleep(randomBetween(20_000, 60_000));

    const { replyContent } = await writeCafeReply({
      page: params.page,
      postUrl: post.url,
      humanEngine,
      skipNavigation: true,
      generateComment: {
        style: 'activity',
        workspace: params.workspace,
        persona,
        cafeCategory: cafe.category ?? undefined,
      },
    });

    await supabase.from('huma_cafe_viral_posts').upsert(
      {
        cafe_id: params.cafeId,
        workspace: params.workspace,
        post_url: post.url.split('?')[0],
        post_title: post.title,
        reply_posted: replyContent,
        account_id: params.accountId,
        is_self_post: false,
        status: 'posted',
        posted_at: new Date().toISOString(),
      },
      { onConflict: 'post_url', ignoreDuplicates: false },
    );

    replyDone++;
    await sleep(randomBetween(600_000, 1_800_000));
  }

  const selfScheduled = await scheduleSelfQA({
    cafeId: params.cafeId,
    workspace: params.workspace,
    accountId: params.accountId,
    count: Math.max(0, ratio.self_qa - counts.self_qa),
  });

  await supabase
    .from('huma_cafe_warmup_accounts')
    .update({ last_activity_at: new Date().toISOString() })
    .eq('account_id', params.accountId)
    .eq('cafe_id', params.cafeId);

  await logOperation({
    level: 'info',
    message: `카페 일상활동 ${cafe.cafe_name}: 답글 ${replyDone} · 자문자답 예약 ${selfScheduled}`,
    account_id: params.accountId,
  });

  return { daily_reply: replyDone, self_qa_scheduled: selfScheduled };
}

/** 자문자답 1단계(질문 게시) → 2단계(본인 댓글) 예약 */
export async function scheduleSelfQA(params: {
  cafeId: string;
  workspace: string;
  accountId: string;
  count: number;
}): Promise<number> {
  if (params.count <= 0) return 0;
  const config = await getCafeViralConfig();
  if (!config.self_qa_enabled) return 0;

  const delayMin = config.self_qa_delay_min || 60;
  const productName = pickRandomProductTopic();
  let scheduled = 0;

  for (let i = 0; i < params.count; i++) {
    const meta: SelfQAMeta = {
      kind: 'self_qa',
      phase: 'post',
      run_after: new Date(Date.now() + delayMin * 60_000 * (i + 1)).toISOString(),
      account_id: params.accountId,
      product_name: productName,
    };

    await supabase.from('huma_cafe_viral_posts').insert({
      cafe_id: params.cafeId,
      workspace: params.workspace,
      account_id: params.accountId,
      post_url: `pending-self-qa-${params.cafeId}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      post_title: '자문자답 예약',
      is_self_post: true,
      status: 'pending',
      reply_drafted: JSON.stringify(meta),
    });
    scheduled++;
  }

  return scheduled;
}

export async function executeSelfQAPhase(params: {
  postId: string;
  accountId: string;
  page: Page;
}): Promise<void> {
  const { data: post } = await supabase.from('huma_cafe_viral_posts').select('*').eq('id', params.postId).single();
  if (!post?.is_self_post) throw new Error('자문자답 게시글 아님');

  const meta = parseSelfQAMeta(post.reply_drafted);
  if (!meta) throw new Error('자문자답 메타 없음');

  const { data: cafe } = await supabase.from('huma_cafe_viral_cafes').select('*').eq('id', post.cafe_id).single();
  if (!cafe) throw new Error('카페 없음');

  const slug = String(cafe.cafe_url).replace(/^https?:\/\/cafe\.naver\.com\//, '').split('/')[0];
  const accountCtx = await loadAccountForBrowser(params.accountId);
  const persona = accountCtx.persona as AccountPersona;
  const humanEngine = await getHumanEngineConfig();

  if (meta.phase === 'post') {
    await assertActivityRatioSlot(post.cafe_id, 'self_qa');

    const clubId = await resolveCafeClubId(params.page, slug);
    if (!clubId) throw new Error('clubId 추출 실패');

    const menuId = await findCafeBoardMenuId(params.page, slug, FREE_BOARD_PATTERN);
    if (!menuId) throw new Error('자유게시판 menuId 찾기 실패');

    const productName = meta.product_name ?? pickRandomProductTopic();
    const draft = await generateSelfQuestion({ productName, persona });

    const { resultUrl } = await writeGenericCafePost({
      page: params.page,
      cafeSlug: slug,
      clubId,
      menuId,
      title: draft.title,
      content: draft.content,
      humanEngine,
    });

    const replyDelayMin = (await getCafeViralConfig()).self_qa_delay_min || 60;
    const replyMeta: SelfQAMeta = {
      kind: 'self_qa',
      phase: 'reply',
      run_after: new Date(Date.now() + replyDelayMin * 60_000).toISOString(),
      account_id: params.accountId,
      product_name: productName,
    };

    await supabase
      .from('huma_cafe_viral_posts')
      .update({
        post_url: resultUrl.split('?')[0],
        post_title: draft.title,
        post_content: draft.content,
        reply_drafted: JSON.stringify(replyMeta),
        status: 'pending',
        account_id: params.accountId,
      })
      .eq('id', params.postId);

    return;
  }

  if (meta.phase === 'reply') {
    const postUrl = post.post_url;
    if (!postUrl || postUrl.startsWith('pending-self-qa')) {
      throw new Error('자문자답 1단계 게시 URL 없음');
    }

    await params.page.goto(postUrl);
    await sleep(randomBetween(20_000, 45_000));

    const reply = await generateCafeCommentFromPage(params.page, {
      style: 'viral',
      workspace: post.workspace,
      persona,
    });

    await writeCafeReply({
      page: params.page,
      postUrl,
      replyContent: reply,
      humanEngine,
      skipNavigation: true,
    });

    await supabase
      .from('huma_cafe_viral_posts')
      .update({
        reply_posted: reply,
        account_id: params.accountId,
        status: 'posted',
        posted_at: new Date().toISOString(),
      })
      .eq('id', params.postId);
  }
}

export async function runActivityReplyFromPending(params: {
  postId: string;
  accountId: string;
  page: Page;
  workspace: string;
}): Promise<void> {
  const { data: post } = await supabase.from('huma_cafe_viral_posts').select('*').eq('id', params.postId).single();
  if (!post?.post_url || post.is_self_post) return;

  await assertActivityRatioSlot(post.cafe_id, 'daily_reply');

  if (post.reply_drafted && !post.reply_drafted.startsWith('{')) {
    await postViralReply({ page: params.page, postUrl: post.post_url, reply: post.reply_drafted });
  } else {
    const accountCtx = await loadAccountForBrowser(params.accountId);
    const humanEngine = await getHumanEngineConfig();

    await params.page.goto(post.post_url);
    await sleep(randomBetween(15_000, 40_000));

    const { replyContent } = await writeCafeReply({
      page: params.page,
      postUrl: post.post_url,
      humanEngine,
      skipNavigation: true,
      generateComment: {
        style: 'viral',
        workspace: params.workspace,
        persona: accountCtx.persona as AccountPersona,
      },
    });

    await supabase
      .from('huma_cafe_viral_posts')
      .update({
        reply_posted: replyContent,
        account_id: params.accountId,
        status: 'posted',
        posted_at: new Date().toISOString(),
      })
      .eq('id', params.postId);
    return;
  }

  await supabase
    .from('huma_cafe_viral_posts')
    .update({
      reply_posted: post.reply_drafted,
      account_id: params.accountId,
      status: 'posted',
      posted_at: new Date().toISOString(),
    })
    .eq('id', params.postId);
}

/** DB pending 자문자답·바이럴 답글 처리 (스케줄러용) */
export async function listDuePendingSelfQAPosts(limit = 5): Promise<Array<{ id: string; account_id: string | null; reply_drafted: string }>> {
  const { data } = await supabase
    .from('huma_cafe_viral_posts')
    .select('id, account_id, reply_drafted')
    .eq('is_self_post', true)
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(limit * 3);

  const now = Date.now();
  return (data ?? []).filter((row) => {
    const meta = parseSelfQAMeta(row.reply_drafted);
    if (!meta?.run_after) return true;
    return new Date(meta.run_after).getTime() <= now;
  }).slice(0, limit) as Array<{ id: string; account_id: string | null; reply_drafted: string }>;
}

/** @deprecated generateCafeComment({ style: 'activity' }) 사용 */
export async function generateActivityReply(params: {
  postTitle: string;
  postExcerpt?: string;
  cafeCategory?: string;
}): Promise<string> {
  return generateCafeComment({
    title: params.postTitle,
    excerpt: params.postExcerpt,
    style: 'activity',
    cafeCategory: params.cafeCategory,
  });
}
