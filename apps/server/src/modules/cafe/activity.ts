import type { Page } from 'playwright';
import { supabase } from '../../middleware/auth.js';
import { askClaudeWithModel } from '../../lib/anthropic-client.js';
import { getSubClaudeModel } from '../../lib/ai-engine.js';
import {
  getCafeViralConfig,
  resolveActivityRatio,
  type ActivityRatio,
} from '../../lib/cafe-viral-config.js';
import { randomBetween, sleep } from '../../lib/utils.js';
import { generateViralReply, postViralReply } from './viral.js';
import { getHumanEngineConfig } from '../../lib/settings.js';
import { writeCafeReply } from '../playwright/naver/cafe.js';
import { logOperation } from '../../lib/log-emitter.js';

function kstTodayStart(): string {
  const now = new Date();
  const kst = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  kst.setHours(0, 0, 0, 0);
  return new Date(kst.getTime() - 9 * 60 * 60 * 1000).toISOString();
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

/** 타인 게시글 공감 답글 — 서비스·앱 언급 없음 (Haiku) */
export async function generateActivityReply(params: {
  postTitle: string;
  cafeCategory?: string;
}): Promise<string> {
  const raw = await askClaudeWithModel({
    model: (await getSubClaudeModel()) || 'claude-haiku-4-5-20251001',
    max_tokens: 200,
    prompt: `네이버 카페 일반 회원으로 아래 게시글에 공감 댓글을 달아줘.

게시글: "${params.postTitle}"
카테고리: ${params.cafeCategory ?? '일반'}

규칙:
- 서비스·앱·사이트 언급 절대 금지
- 순수 공감·경험 공유·정보 제공
- 2~3문장, 구어체, 이모지 0~1개
- 광고처럼 보이면 안 됨

댓글만 출력.`,
  });
  return raw?.trim() || '공감되는 글이네요. 저도 비슷한 경험이 있어요.';
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

    const comment = await generateActivityReply({
      postTitle: post.title,
      cafeCategory: cafe.category ?? undefined,
    });

    await writeCafeReply({
      page: params.page,
      postUrl: post.url,
      replyContent: comment,
      humanEngine,
    });

    await supabase.from('huma_cafe_viral_posts').upsert(
      {
        cafe_id: params.cafeId,
        workspace: params.workspace,
        post_url: post.url.split('?')[0],
        post_title: post.title,
        reply_posted: comment,
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

/** 자문자답은 1~3시간 간격 별도 스케줄 — 즉시 실행 대신 pending 등록 */
export async function scheduleSelfQA(params: {
  cafeId: string;
  workspace: string;
  count: number;
}): Promise<number> {
  if (params.count <= 0) return 0;
  const config = await getCafeViralConfig();
  if (!config.self_qa_enabled) return 0;

  const delayMin = config.self_qa_delay_min || 60;
  let scheduled = 0;

  for (let i = 0; i < params.count; i++) {
    await supabase.from('huma_cafe_viral_posts').insert({
      cafe_id: params.cafeId,
      workspace: params.workspace,
      post_url: `pending-self-qa-${params.cafeId}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      post_title: '자문자답 예약',
      is_self_post: true,
      status: 'pending',
      reply_drafted: JSON.stringify({
        kind: 'self_qa',
        run_after: new Date(Date.now() + delayMin * 60_000 * (i + 1)).toISOString(),
      }),
    });
    scheduled++;
  }

  return scheduled;
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

  const reply =
    post.reply_drafted ||
    (await generateViralReply({ postTitle: post.post_title ?? '', workspace: params.workspace }));

  await postViralReply({ page: params.page, postUrl: post.post_url, reply });
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
