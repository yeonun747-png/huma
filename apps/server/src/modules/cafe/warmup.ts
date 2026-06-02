import type { Page } from 'playwright';
import { supabase } from '../../middleware/auth.js';
import { logOperation } from '../../lib/log-emitter.js';
import { notifySlack } from '../watcher/detector.js';
import { randomBetween, sleep } from '../../lib/utils.js';
import type { GradeRequirements } from './viral.js';
import { generateGreetingPost, postViralReply } from './viral.js';
import { writeCafeReply, writeGenericCafePost } from '../playwright/naver/cafe.js';
import { getHumanEngineConfig } from '../../lib/settings.js';
import { loadAccountForBrowser } from '../playwright/account-loader.js';
import {
  GREETING_BOARD_PATTERN,
  findCafeBoardMenuId,
  resolveCafeClubId,
} from '../../lib/cafe-nav.js';
import type { AccountPersona } from '../playwright/persona.js';

const GRADE_PATTERNS = {
  comments: /댓글\s*(\d+)개|(\d+)개\s*댓글/,
  likes: /추천\s*(\d+)개|(\d+)번\s*추천/,
  greeting: /가입인사|인사말|자기소개/,
  posts: /게시글\s*(\d+)개|(\d+)개\s*게시/,
};

export async function autoDetectGradeRequirements(cafeSlug: string, page: Page): Promise<GradeRequirements | null> {
  try {
    await page.goto(`https://cafe.naver.com/${cafeSlug}`);
    await page.waitForLoadState('networkidle').catch(() => {});
    await sleep(randomBetween(2000, 4000));

    const notices = await page
      .$$eval('.article-board .td_article a, .board-list a', (els) =>
        els.map((el) => (el as HTMLElement).textContent?.trim()).filter(Boolean).slice(0, 20) as string[],
      )
      .catch(() => [] as string[]);

    const detected: GradeRequirements = {};
    for (const notice of notices) {
      if (!notice) continue;
      const cm = notice.match(GRADE_PATTERNS.comments);
      if (cm) detected.comment_count = parseInt(cm[1] || cm[2], 10);
      const lm = notice.match(GRADE_PATTERNS.likes);
      if (lm) detected.like_count = parseInt(lm[1] || lm[2], 10);
      if (GRADE_PATTERNS.greeting.test(notice)) detected.greeting_post = 1;
      const pm = notice.match(GRADE_PATTERNS.posts);
      if (pm) detected.posts = parseInt(pm[1] || pm[2], 10);
    }

    return Object.keys(detected).length > 0 ? detected : null;
  } catch {
    return null;
  }
}

async function getPopularPostUrls(cafeSlug: string, page: Page, limit: number): Promise<Array<{ url: string; title: string }>> {
  await page.goto(`https://cafe.naver.com/${cafeSlug}`);
  await page.waitForLoadState('networkidle').catch(() => {});
  const links = await page.$$eval('a.article, .article-board .td_article a', (els) =>
    els
      .map((el) => ({
        title: (el as HTMLElement).textContent?.trim() ?? '',
        url: (el as HTMLAnchorElement).href ?? '',
      }))
      .filter((x) => x.url),
  );
  return links.slice(0, limit);
}

async function postGreetingIfNeeded(params: {
  accountId: string;
  cafeId: string;
  cafeName: string;
  cafeSlug: string;
  page: Page;
  greetingRequired: boolean;
  alreadyPosted: boolean;
}): Promise<boolean> {
  if (!params.greetingRequired || params.alreadyPosted) return params.alreadyPosted;

  const accountCtx = await loadAccountForBrowser(params.accountId);
  const persona = accountCtx.persona as AccountPersona;
  const humanEngine = await getHumanEngineConfig();

  const clubId = await resolveCafeClubId(params.page, params.cafeSlug);
  if (!clubId) throw new Error('가입인사: clubId 추출 실패');

  const menuId = await findCafeBoardMenuId(params.page, params.cafeSlug, GREETING_BOARD_PATTERN);
  if (!menuId) throw new Error('가입인사 게시판 menuId 찾기 실패');

  const draft = await generateGreetingPost({ persona, cafeName: params.cafeName });

  await writeGenericCafePost({
    page: params.page,
    cafeSlug: params.cafeSlug,
    clubId,
    menuId,
    title: draft.title,
    content: draft.content,
    humanEngine,
  });

  await supabase
    .from('huma_cafe_warmup_accounts')
    .update({ greeting_posted: true, last_activity_at: new Date().toISOString() })
    .eq('account_id', params.accountId)
    .eq('cafe_id', params.cafeId);

  await sleep(randomBetween(300_000, 600_000));
  return true;
}

export async function runCafeWarmup(params: {
  accountId: string;
  cafeId: string;
  page: Page;
}): Promise<void> {
  const { data: cafe } = await supabase.from('huma_cafe_viral_cafes').select('*').eq('id', params.cafeId).single();
  if (!cafe) throw new Error('카페 없음');

  const slug = String(cafe.cafe_url).replace(/^https?:\/\/cafe\.naver\.com\//, '').split('/')[0];

  let requirements = cafe.grade_requirements as GradeRequirements | null;
  if (!requirements || Object.keys(requirements).length === 0) {
    requirements = await autoDetectGradeRequirements(slug, params.page);
    if (!requirements) {
      await notifySlack(`⚠️ 카페 등업 조건 감지 실패: ${cafe.cafe_name} — 수동 확인 필요`);
      return;
    }
    await supabase
      .from('huma_cafe_viral_cafes')
      .update({
        grade_requirements: requirements,
        grade_auto_detected: true,
        grade_detected_at: new Date().toISOString(),
      })
      .eq('id', params.cafeId);
  }

  const { data: warmup } = await supabase
    .from('huma_cafe_warmup_accounts')
    .select('*')
    .eq('account_id', params.accountId)
    .eq('cafe_id', params.cafeId)
    .maybeSingle();

  if (!warmup) {
    await supabase.from('huma_cafe_warmup_accounts').insert({
      account_id: params.accountId,
      cafe_id: params.cafeId,
      status: 'warming',
    });
  }

  const row = warmup ?? { comment_count: 0, greeting_posted: false, is_graded_up: false };

  await postGreetingIfNeeded({
    accountId: params.accountId,
    cafeId: params.cafeId,
    cafeName: cafe.cafe_name,
    cafeSlug: slug,
    page: params.page,
    greetingRequired: (requirements.greeting_post ?? 0) > 0,
    alreadyPosted: row.greeting_posted ?? false,
  }).catch(async (err) => {
    await logOperation({
      level: 'warn',
      message: `가입인사 게시 실패 (${cafe.cafe_name}): ${(err as Error).message}`,
      account_id: params.accountId,
    });
  });

  const accountCtx = await loadAccountForBrowser(params.accountId);
  const persona = accountCtx.persona as AccountPersona;
  const needed = (requirements.comment_count ?? 0) - (row.comment_count ?? 0);

  if (needed > 0) {
    const posts = await getPopularPostUrls(slug, params.page, needed * 2);
    let done = 0;
    const humanEngine = await getHumanEngineConfig();

    for (const post of posts) {
      if (done >= needed) break;
      await params.page.goto(post.url);
      await sleep(randomBetween(20000, 60000));

      try {
        await writeCafeReply({
          page: params.page,
          postUrl: post.url,
          humanEngine,
          skipNavigation: true,
          generateComment: {
            style: 'viral',
            workspace: cafe.workspace,
            persona,
          },
        });
      } catch (err) {
        await logOperation({
          level: 'warn',
          message: `워밍업 댓글 실패 (${post.title}): ${(err as Error).message}`,
          account_id: params.accountId,
        });
        continue;
      }

      await supabase
        .from('huma_cafe_warmup_accounts')
        .update({
          comment_count: (row.comment_count ?? 0) + done + 1,
          last_activity_at: new Date().toISOString(),
        })
        .eq('account_id', params.accountId)
        .eq('cafe_id', params.cafeId);

      done++;
      await sleep(randomBetween(600_000, 1_800_000));
    }
  }

  const commentTarget = requirements.comment_count ?? 0;
  const greetingTarget = requirements.greeting_post ?? 0;
  const { data: updated } = await supabase
    .from('huma_cafe_warmup_accounts')
    .select('comment_count, greeting_posted')
    .eq('account_id', params.accountId)
    .eq('cafe_id', params.cafeId)
    .single();

  const commentsOk = commentTarget <= 0 || (updated?.comment_count ?? 0) >= commentTarget;
  const greetingOk = greetingTarget <= 0 || updated?.greeting_posted === true;

  if (commentsOk && greetingOk) {
    await supabase
      .from('huma_cafe_warmup_accounts')
      .update({
        is_graded_up: true,
        graded_up_at: new Date().toISOString(),
        status: 'active',
      })
      .eq('account_id', params.accountId)
      .eq('cafe_id', params.cafeId);
    await notifySlack(`✅ 등업 워밍업 완료: ${cafe.cafe_name} — 계정 ${params.accountId}`);
    await logOperation({
      level: 'info',
      message: `카페 워밍업 완료 ${cafe.cafe_name}`,
      account_id: params.accountId,
    });
  }
}

export async function executeViralReplyPost(params: {
  postId: string;
  accountId: string;
  page: Page;
}): Promise<void> {
  const { data: post } = await supabase.from('huma_cafe_viral_posts').select('*').eq('id', params.postId).single();
  if (!post) throw new Error('게시글 없음');

  if (post.reply_drafted && !String(post.reply_drafted).startsWith('{')) {
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
        workspace: post.workspace,
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
