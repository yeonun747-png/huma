import type { Page } from 'playwright';
import { supabase } from '../../../middleware/auth.js';
import { getSetting, getHumanEngineConfig } from '../../../lib/settings.js';
import { createBrowserForAccount, closeBrowserContext } from '../browser.js';
import { loadAccountForBrowser, maybeIncrementWarmupDay } from '../account-loader.js';
import { naverLogin } from './login.js';
import { humanSleep, humanType } from '../../human-engine/typing.js';
import { scrollRead, measureRTT, rttScale, scaledHumanSleep } from '../../human-engine/timing.js';
import { humanClick } from '../../human-engine/mouse.js';
import { randomBetween, shuffleArray } from '../../../lib/utils.js';
import { getTodayPlan, maxCrankVisitsForWarmup } from '../warmup.js';
import type { AccountPersona } from '../persona.js';
import { acquireModem, releaseModem, type ModemSession } from '../../proxy/manager.js';
import { handleLayer4Detection, isCaptchaError, isBlockError } from '../../watcher/detector.js';
import { generateCrankComment } from './crank-comment.js';
import { preSessionWarmup } from './pre-session-warmup.js';
import { selectCrankKeywords } from './crank-keywords.js';
import {
  reconnectModemIfAccountSwitched,
  recordLastAccountOnModem,
} from '../../../lib/modem-last-account.js';
import { applyCrankResourceBlocking } from './crank-resource-block.js';

interface SocialCrankConfig {
  visits_per_session: number;
  our_blog_ratio: number;
  other_blog_ratio: number;
  min_visit_interval_days: number;
  keywords: string[];
}

export async function naturalVisitViaSearch(page: Page, keyword: string, scale = 1): Promise<string | null> {
  await page.goto(`https://search.naver.com/search.naver?where=post&query=${encodeURIComponent(keyword)}`);
  await page.waitForLoadState('networkidle');
  await scrollRead(page, randomBetween(2000, 5000));

  const results = await page.locator('.api_txt_lines').all();
  if (!results.length) return null;
  const idx = Math.floor(Math.random() * Math.min(5, results.length));
  await results[idx].click();
  await scaledHumanSleep(500, 1500, scale);
  await page.waitForLoadState('networkidle');
  return page.url();
}

export interface RunSocialCrankOptions {
  modemSession?: ModemSession;
  skipModemAcquire?: boolean;
}

export async function runSocialCrank(
  accountId: string,
  payload: { ourBlogUrls: string[]; targetDate?: string },
  options?: RunSocialCrankOptions,
) {
  await maybeIncrementWarmupDay(accountId);

  let modemSession: ModemSession | undefined = options?.modemSession;
  const ownsModem = !options?.skipModemAcquire;

  try {
    if (ownsModem) {
      modemSession = await acquireModem(accountId);
      if (!modemSession) throw new Error('NO_MODEM');
      await reconnectModemIfAccountSwitched(modemSession.proxyPort, accountId);
    } else if (!modemSession) {
      throw new Error('NO_MODEM');
    }
    const accountCtx = await loadAccountForBrowser(accountId, modemSession.proxyPort);
    if (accountCtx.account_type !== 'crank') {
      throw new Error('ACCOUNT_NOT_CRANK');
    }
    const warmupDay = accountCtx.warmup_day ?? 0;
    const plan = await getTodayPlan(accountCtx);
    const persona = accountCtx.persona;

    const config = await getSetting<SocialCrankConfig>('social_crank', {
      visits_per_session: 15,
      our_blog_ratio: 0.25,
      other_blog_ratio: 0.75,
      min_visit_interval_days: 5,
      keywords: persona.interests.length ? persona.interests : ['사주풀이', '꿈해몽', '신년운세'],
    });

    const maxVisits = Math.min(
      config.visits_per_session,
      plan.blogVisits,
      maxCrankVisitsForWarmup(warmupDay),
    );

    const ourTarget = Math.max(0, Math.round(maxVisits * config.our_blog_ratio));
    const otherTarget = Math.max(0, maxVisits - ourTarget);

    let scale = 1;
    if (accountCtx.proxy_port) {
      const rtt = await measureRTT(accountCtx.proxy_port);
      scale = rttScale(rtt);
    }

    const { context } = await createBrowserForAccount(accountCtx);

    try {
      const warmupPage = await context.newPage();
      await preSessionWarmup(warmupPage, persona, 'crank');
      await warmupPage.close();
      await applyCrankResourceBlocking(context);

      await naverLogin(context, accountId, { profilePath: accountCtx.profile_path });
      const page = await context.newPage();

      const ourBlogs = await selectOurBlogsToVisit(
        accountId,
        payload.ourBlogUrls,
        persona,
        ourTarget,
        config.min_visit_interval_days,
      );
      const crankKeywords = selectCrankKeywords(config.keywords);
      const otherBlogs = await searchRelatedBlogs(page, crankKeywords, otherTarget, scale);
      const allTargets = shuffleArray([...ourBlogs, ...otherBlogs]).slice(0, maxVisits);

      let likesDone = 0;
      let commentsDone = 0;

      for (const target of allTargets) {
        if (target.useSearch && target.keyword) {
          const url = await naturalVisitViaSearch(page, target.keyword, scale);
          if (!url) continue;
        } else {
          await page.goto(target.url);
          await page.waitForLoadState('networkidle');
        }

        await scrollRead(page, randomBetween(60000, 180000 * (persona.visitDurationMin / 4)));

        const doLike = target.doLike && likesDone < plan.likes;
        const doComment = target.doComment && commentsDone < plan.comments;

        await visitBlogActions(page, { ...target, doLike, doComment }, scale);
        if (doLike) likesDone++;
        if (doComment) commentsDone++;

        await humanSleep(30000, 120000);
      }

      await updateVisitHistory(accountId, ourBlogs.map((b) => b.url));
      await updateCrankCount(accountId, allTargets.length);
      await recordLastAccountOnModem(modemSession.proxyPort, accountId);
    } finally {
      await closeBrowserContext(context);
    }
  } catch (err) {
    if (isCaptchaError(err) || isBlockError(err)) {
      await handleLayer4Detection(accountId, err, modemSession);
    }
    throw err;
  } finally {
    if (ownsModem && modemSession) await releaseModem(modemSession);
  }
}

async function visitBlogActions(
  page: Page,
  target: { doLike: boolean; doComment: boolean; commentText?: string },
  scale: number,
) {
  if (target.doLike) {
    const likeBtn = page.locator('.u_likeit_list_btn');
    if (await likeBtn.isVisible()) {
      await scaledHumanSleep(2000, 5000, scale);
      await humanClick(page, '.u_likeit_list_btn');
    }
  }

  if (target.doComment) {
    const commentArea = page.locator('.u_cbox_write_wrap textarea');
    if (await commentArea.isVisible()) {
      try {
        const commentText = target.commentText ?? (await generateCrankComment(page));
        await scaledHumanSleep(5000, 15000, scale);
        await commentArea.click();
        const humanConfig = await getHumanEngineConfig();
        await humanType(page, commentArea, commentText, humanConfig);
        await scaledHumanSleep(2000, 5000, scale);
        await humanClick(page, '.u_cbox_btn_upload');
      } catch {
        /* AI 댓글 생성 실패 — 고정 템플릿 대신 스킵 */
      }
    }
  }
}

async function selectOurBlogsToVisit(
  accountId: string,
  ourBlogUrls: string[],
  persona: AccountPersona,
  maxCount: number,
  minIntervalDays: number,
) {
  if (maxCount <= 0) return [];

  const { data: account } = await supabase
    .from('huma_accounts')
    .select('last_visited_our_blog')
    .eq('id', accountId)
    .single();

  const visitHistory = (account?.last_visited_our_blog as Record<string, string>) || {};
  const cutoff = new Date(Date.now() - minIntervalDays * 24 * 60 * 60 * 1000);

  return ourBlogUrls
    .filter((url) => {
      const lastVisit = visitHistory[url];
      return !lastVisit || new Date(lastVisit) < cutoff;
    })
    .slice(0, maxCount)
    .map((url) => ({
      url,
      isOurBlog: true,
      doLike: Math.random() < persona.likeProb,
      doComment: Math.random() < persona.commentProb,
      commentText: undefined,
      useSearch: false,
      keyword: undefined as string | undefined,
    }));
}

async function searchRelatedBlogs(page: Page, keywords: string[], count: number, scale: number) {
  if (count <= 0) return [];

  const keyword = keywords[Math.floor(Math.random() * keywords.length)];
  const visitedUrl = await naturalVisitViaSearch(page, keyword, scale);

  const urls: string[] = visitedUrl ? [visitedUrl] : [];

  if (urls.length < count) {
    await page.goto(`https://search.naver.com/search.naver?where=post&query=${encodeURIComponent(keyword)}`);
    await page.waitForLoadState('networkidle');
    await scaledHumanSleep(2000, 4000, scale);

    const links = await page.locator('.detail_box .sub_txt a').all();
    for (const link of links.slice(0, count + 5)) {
      const href = await link.getAttribute('href');
      if (href?.includes('blog.naver.com') && !urls.includes(href)) urls.push(href);
    }
  }

  return shuffleArray(urls)
    .slice(0, count)
    .map((url) => ({
      url,
      isOurBlog: false,
      doLike: Math.random() < 0.4,
      doComment: false,
      commentText: undefined,
      useSearch: false,
      keyword: undefined as string | undefined,
    }));
}

async function updateVisitHistory(accountId: string, urls: string[]) {
  const { data: account } = await supabase
    .from('huma_accounts')
    .select('last_visited_our_blog')
    .eq('id', accountId)
    .single();

  const history = { ...((account?.last_visited_our_blog as Record<string, string>) || {}) };
  const now = new Date().toISOString();
  for (const url of urls) history[url] = now;

  await supabase.from('huma_accounts').update({ last_visited_our_blog: history }).eq('id', accountId);
}

async function updateCrankCount(accountId: string, count: number) {
  const { data } = await supabase.from('huma_accounts').select('crank_count_today').eq('id', accountId).single();
  await supabase
    .from('huma_accounts')
    .update({ crank_count_today: (data?.crank_count_today ?? 0) + count })
    .eq('id', accountId);
}
