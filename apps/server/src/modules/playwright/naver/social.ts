import type { Page } from 'playwright';
import type { Workspace } from '@huma/shared';
import { crankWorkspaceFromLabel } from '@huma/shared';
import { supabase } from '../../../middleware/auth.js';
import { fetchPostingBlogUrls } from '../../../lib/crank-scheduler.js';
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
import { selectCrankKeywordsForWorkspace } from './crank-keywords.js';
import {
  reconnectModemIfAccountSwitched,
  recordLastAccountOnModem,
} from '../../../lib/modem-last-account.js';
import { applyCrankResourceBlocking } from './crank-resource-block.js';
import { logCrankActivity } from '../../../lib/crank-activity.js';
import { blogSearchUrl, collectNaverSearchUrls } from '../../../lib/naver-search-links.js';

interface SocialCrankConfig {
  visits_per_session?: number;
  daily_limit_per_account?: number;
  our_blog_ratio: number;
  other_blog_ratio: number;
  min_visit_interval_days: number;
  keyword_pick_count: number;
  keyword_pools?: Partial<Record<Workspace, string[]>>;
}

interface BlogTarget {
  url: string;
  isOurBlog: boolean;
  doLike: boolean;
  doComment: boolean;
}

async function getAccountCrankWorkspace(accountId: string): Promise<Workspace> {
  const { data } = await supabase
    .from('huma_accounts')
    .select('crank_workspace, crank_label')
    .eq('id', accountId)
    .single();

  if (data?.crank_workspace) return data.crank_workspace as Workspace;
  return crankWorkspaceFromLabel(data?.crank_label) ?? 'yeonun';
}

async function loadVisitHistory(accountId: string): Promise<Record<string, string>> {
  const { data } = await supabase
    .from('huma_accounts')
    .select('last_visited_our_blog')
    .eq('id', accountId)
    .single();
  return (data?.last_visited_our_blog as Record<string, string>) || {};
}

function filterUrlsByVisitInterval(
  urls: string[],
  visitHistory: Record<string, string>,
  minIntervalDays: number,
): string[] {
  const cutoff = new Date(Date.now() - minIntervalDays * 24 * 60 * 60 * 1000);
  return urls.filter((url) => {
    const lastVisit = visitHistory[url];
    return !lastVisit || new Date(lastVisit) < cutoff;
  });
}

/** v3.28 — 네이버 블로그 검색(where=blog)으로 타겟 URL 자동 탐색 */
async function searchNaverBlogs(
  page: Page,
  keywords: string[],
  limit: number,
  scale: number,
): Promise<string[]> {
  if (limit <= 0 || keywords.length === 0) return [];

  const results: string[] = [];
  for (const keyword of keywords) {
    await page.goto(blogSearchUrl(keyword));
    await page.waitForLoadState('networkidle').catch(() => {});
    await scaledHumanSleep(2000, 4000, scale);

    const found = await collectNaverSearchUrls(page, 'blog', limit);
    for (const href of found) {
      if (!results.includes(href)) results.push(href);
      if (results.length >= limit) break;
    }

    if (results.length >= limit) break;
    await scaledHumanSleep(3000, 6000, scale);
  }

  return [...new Set(results)].slice(0, limit);
}

function buildBlogTargets(
  urls: string[],
  persona: AccountPersona,
  isOurBlog: boolean,
): BlogTarget[] {
  return urls.map((url) => ({
    url,
    isOurBlog,
    doLike: Math.random() < (isOurBlog ? persona.likeProb : 0.4),
    doComment: Math.random() < persona.commentProb,
  }));
}

export interface RunSocialCrankOptions {
  modemSession?: ModemSession;
  skipModemAcquire?: boolean;
}

export async function runSocialCrank(
  accountId: string,
  payload: { ourBlogUrls?: string[]; targetDate?: string },
  options?: RunSocialCrankOptions,
) {
  await maybeIncrementWarmupDay(accountId);

  let modemSession: ModemSession | undefined = options?.modemSession;
  const ownsModem = !options?.skipModemAcquire;

  try {
    if (!modemSession && ownsModem) {
      modemSession = await acquireModem(accountId);
    }
    if (!modemSession) throw new Error('NO_MODEM');

    // v3.33 — 계정 전환 시 reconnect 1회 → preSessionWarmup이 자연 간격(규칙⑦)
    await reconnectModemIfAccountSwitched(modemSession.proxyPort, accountId);
    const accountCtx = await loadAccountForBrowser(accountId, modemSession.proxyPort);
    if (accountCtx.account_type !== 'crank') {
      throw new Error('ACCOUNT_NOT_CRANK');
    }
    const crankWorkspace = await getAccountCrankWorkspace(accountId);
    const warmupDay = accountCtx.warmup_day ?? 0;
    const plan = await getTodayPlan(accountCtx);
    const persona = accountCtx.persona;

    const config = await getSetting<SocialCrankConfig>('social_crank', {
      visits_per_session: 15,
      our_blog_ratio: 0.25,
      other_blog_ratio: 0.75,
      min_visit_interval_days: 5,
      keyword_pick_count: 4,
    });

    const sessionCap = config.visits_per_session ?? config.daily_limit_per_account ?? 15;
    const maxVisits = Math.min(sessionCap, plan.blogVisits, maxCrankVisitsForWarmup(warmupDay));

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

      const visitHistory = await loadVisitHistory(accountId);
      const ourBlogUrls =
        payload.ourBlogUrls?.length ? payload.ourBlogUrls : await fetchPostingBlogUrls(crankWorkspace);

      const keywords = selectCrankKeywordsForWorkspace(
        crankWorkspace,
        config.keyword_pools,
        config.keyword_pick_count ?? 4,
      );

      const otherCandidates = await searchNaverBlogs(page, keywords, otherTarget * 2, scale);
      const otherUrls = filterUrlsByVisitInterval(otherCandidates, visitHistory, config.min_visit_interval_days)
        .slice(0, otherTarget);
      const ourUrls = filterUrlsByVisitInterval(shuffleArray(ourBlogUrls), visitHistory, config.min_visit_interval_days)
        .slice(0, ourTarget);

      if (otherTarget > 0 && otherUrls.length === 0 && otherCandidates.length === 0) {
        throw new Error('NO_LINKS_FOUND:session:네이버 블로그 검색');
      }

      const allTargets: BlogTarget[] = [
        ...buildBlogTargets(otherUrls, persona, false),
        ...buildBlogTargets(ourUrls, persona, true),
      ].slice(0, maxVisits);

      let likesDone = 0;
      let commentsDone = 0;
      const visitedUrls: string[] = [];

      for (const target of allTargets) {
        await page.goto(target.url);
        await page.waitForLoadState('networkidle');

        await scrollRead(page, randomBetween(60000, 180000 * (persona.visitDurationMin / 4)));

        const doLike = target.doLike && likesDone < plan.likes;
        const doComment = target.doComment && commentsDone < plan.comments;

        const pageUrl = page.url();
        const pageTitle = await page.title().catch(() => '');
        const actions = await visitBlogActions(page, { ...target, doLike, doComment }, scale, crankWorkspace);
        if (actions.visited) {
          visitedUrls.push(pageUrl);
          await logCrankActivity({
            accountId,
            type: '방문',
            targetUrl: pageUrl,
            targetTitle: pageTitle.slice(0, 80),
            dwellSec: randomBetween(60, 180),
          });
        }
        if (actions.liked) {
          likesDone++;
          await logCrankActivity({ accountId, type: '공감', targetUrl: pageUrl, targetTitle: pageTitle.slice(0, 80) });
        }
        if (actions.commented) {
          commentsDone++;
          await logCrankActivity({
            accountId,
            type: '댓글',
            targetUrl: pageUrl,
            targetTitle: pageTitle.slice(0, 80),
            comment: actions.commentText,
          });
        }

        await humanSleep(30000, 120000);
      }

      await updateVisitHistory(accountId, visitedUrls);
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
  crankWorkspace: Workspace,
): Promise<{ visited: boolean; liked: boolean; commented: boolean; commentText?: string }> {
  let liked = false;
  let commented = false;
  let commentText: string | undefined;

  if (target.doLike) {
    const likeBtn = page.locator('.u_likeit_list_btn');
    if (await likeBtn.isVisible()) {
      await scaledHumanSleep(2000, 5000, scale);
      await humanClick(page, '.u_likeit_list_btn');
      liked = true;
    }
  }

  if (target.doComment) {
    const commentArea = page.locator('.u_cbox_write_wrap textarea');
    if (await commentArea.isVisible()) {
      try {
        commentText = target.commentText ?? (await generateCrankComment(page, crankWorkspace));
        await scaledHumanSleep(5000, 15000, scale);
        await commentArea.click();
        const humanConfig = await getHumanEngineConfig();
        await humanType(page, commentArea, commentText, humanConfig);
        await scaledHumanSleep(2000, 5000, scale);
        await humanClick(page, '.u_cbox_btn_upload');
        commented = true;
      } catch {
        /* AI 댓글 생성 실패 — 스킵 */
      }
    }
  }

  return { visited: true, liked, commented, commentText };
}

async function updateVisitHistory(accountId: string, urls: string[]) {
  if (urls.length === 0) return;

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
