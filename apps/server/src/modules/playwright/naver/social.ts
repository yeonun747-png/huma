import type { BrowserContext, Page } from 'playwright';
import type { Workspace } from '@huma/shared';
import { crankWorkspaceFromLabel } from '@huma/shared';
import { supabase } from '../../../middleware/auth.js';
import { fetchPostingBlogUrls } from '../../../lib/crank-scheduler.js';
import { getSetting, getHumanEngineConfig } from '../../../lib/settings.js';
import {
  acquireWorkflowPage,
  createBrowserForAccount,
  closeBrowserContext,
  releaseWorkflowPage,
} from '../browser.js';
import {
  clearCrankSessionProgress,
  setCrankSessionProgress,
} from '../../../lib/crank-session-progress.js';
import { loadAccountForBrowser, maybeIncrementWarmupDay } from '../account-loader.js';
import { ensureNaverLoggedIn, naverLogin } from './login.js';
import { humanSleep, humanType } from '../../human-engine/typing.js';
import { measureRTT, rttScale, scaledHumanSleep, scrollWithReverse } from '../../human-engine/timing.js';
import { humanClick, humanClickLocator } from '../../human-engine/mouse.js';
import { randomBetween, shuffleArray } from '../../../lib/utils.js';
import { getTodayPlan, maxCrankVisitsForWarmup } from '../warmup.js';
import type { AccountPersona } from '../persona.js';
import { acquireModem, releaseModem, type ModemSession } from '../../proxy/manager.js';
import { handleLayer4Detection } from '../../watcher/detector.js';
import {
  CAPTCHA_AWAITING_HUMAN,
  isCrankCaptchaHoldSignal,
  isCrankHumanHoldError,
  tryEnterCrankCaptchaHold,
} from '../../../lib/crank-captcha-hold.js';
import { generateCrankComment } from './crank-comment.js';
import { preSessionWarmup } from './pre-session-warmup.js';
import { selectCrankKeywordsForWorkspace } from './crank-keywords.js';
import {
  reconnectModemIfAccountSwitched,
  recordLastAccountOnModem,
} from '../../../lib/modem-last-account.js';
import { ensurePhoneCrankTether } from '../../../lib/modem-phone-tether.js';
import { applyCrankResourceBlocking } from './crank-resource-block.js';
import { logCrankActivity } from '../../../lib/crank-activity.js';
import { CRANK_NAV_TIMEOUT_MS } from '../../../lib/playwright-nav-timeout.js';
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

/**
 * 세션 절대 상한(분). 스케줄 락 TTL(CRANK_SCHEDULED_LOCK_TTL_SEC=120분)보다 충분히 짧게 유지해
 * 세션 도중 Redis 락이 만료되어 같은 동글을 다른 작업이 점유하는 사태(규칙⑬ 위반)를 막는다.
 */
const SESSION_HARD_CAP_MS = 45 * 60 * 1000;
const CRANK_BLOG_DWELL_MS: [number, number] = [10_000, 20_000];
const CRANK_BLOG_GAP_MS: [number, number] = [3000, 8000];

/** 블로그 글 — 들어가자마자 스크롤하며 10~20초 내 훑기 */
async function quickBlogGlance(page: Page): Promise<number> {
  const dwellMs = randomBetween(CRANK_BLOG_DWELL_MS[0], CRANK_BLOG_DWELL_MS[1]);
  await humanSleep(300, 800);
  const scrollMs = Math.round(dwellMs * 0.65);
  await scrollWithReverse(page, scrollMs, [250, 650], [120, 380], 0.1);
  const remainMs = Math.max(1500, dwellMs - scrollMs);
  await humanSleep(remainMs, remainMs + 800);
  return Math.round(dwellMs / 1000);
}

function fillVisitUrls(filtered: string[], candidates: string[], target: number): string[] {
  const urls = [...filtered];
  if (urls.length >= target) return urls.slice(0, target);
  for (const href of candidates) {
    if (!urls.includes(href)) urls.push(href);
    if (urls.length >= target) break;
  }
  return urls;
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
    await page.goto(blogSearchUrl(keyword), {
      waitUntil: 'domcontentloaded',
      timeout: CRANK_NAV_TIMEOUT_MS,
    });
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
  /** 큐 job — CAPTCHA·인증 시 VNC hold (포스팅과 동일) */
  humaJobId?: string;
  releaseAccountLock?: () => void;
}

export async function runSocialCrank(
  accountId: string,
  payload: { ourBlogUrls?: string[]; targetDate?: string; resumeAfterCaptcha?: boolean },
  options?: RunSocialCrankOptions,
) {
  await maybeIncrementWarmupDay(accountId);

  let modemSession: ModemSession | undefined = options?.modemSession;
  const ownsModem = !options?.skipModemAcquire;
  let heldForCaptcha = false;
  let context: BrowserContext | undefined;
  const jobId = options?.humaJobId;

  try {
    if (!modemSession && ownsModem) {
      modemSession = await acquireModem(accountId);
    }
    if (!modemSession) throw new Error('NO_MODEM');

    await setCrankSessionProgress(jobId, '준비', `:${modemSession.proxyPort}`);
    // v3.33 — 계정 전환 시 reconnect 1회 → preSessionWarmup이 자연 간격(규칙⑦)
    await setCrankSessionProgress(jobId, 'IP 교체');
    await reconnectModemIfAccountSwitched(modemSession.proxyPort, accountId);
    await ensurePhoneCrankTether(modemSession.proxyPort);
    const accountCtx = await loadAccountForBrowser(accountId, modemSession.proxyPort);
    if (accountCtx.account_type !== 'crank') {
      throw new Error('ACCOUNT_NOT_CRANK');
    }
    // IP 소유권을 로그인/활동 전에 즉시 기록한다. 세션이 캡차·크래시로 중단돼도
    // "이 IP는 이 계정이 점유"가 남아, 다음 다른 계정이 같은(소진된) IP를 재사용하는 것을 차단(규칙⑬).
    await recordLastAccountOnModem(modemSession.proxyPort, accountId);
    const crankWorkspace = await getAccountCrankWorkspace(accountId);
    const warmupDay = accountCtx.warmup_day ?? 0;
    const plan = await getTodayPlan(accountCtx);
    const persona = accountCtx.persona;

    const { data: crankMeta } = await supabase
      .from('huma_accounts')
      .select('last_crank_at')
      .eq('id', accountId)
      .single();
    const lastCrankAt = crankMeta?.last_crank_at as string | null | undefined;
    const expressWarmup =
      Boolean(lastCrankAt) &&
      Date.now() - new Date(lastCrankAt!).getTime() < 48 * 3600 * 1000;

    const config = await getSetting<SocialCrankConfig>('social_crank', {
      visits_per_session: 10,
      our_blog_ratio: 0.25,
      other_blog_ratio: 0.75,
      min_visit_interval_days: 5,
      keyword_pick_count: 4,
    });

    const sessionCap = config.visits_per_session ?? config.daily_limit_per_account ?? 10;
    const maxVisits = Math.min(sessionCap, plan.blogVisits, maxCrankVisitsForWarmup(warmupDay));

    const ourTarget = Math.max(0, Math.round(maxVisits * config.our_blog_ratio));
    const otherTarget = Math.max(0, maxVisits - ourTarget);

    let scale = 1;
    if (accountCtx.proxy_port) {
      const rtt = await measureRTT(accountCtx.proxy_port);
      scale = rttScale(rtt);
    }

    const resumeAfterCaptcha = Boolean(payload.resumeAfterCaptcha);

    await setCrankSessionProgress(jobId, '브라우저 기동');
    context = (await createBrowserForAccount(accountCtx)).context;

    try {
      if (resumeAfterCaptcha) {
        await setCrankSessionProgress(jobId, '세션 확인', 'CAPTCHA 후 재개');
        await ensurePhoneCrankTether(modemSession.proxyPort);
        await applyCrankResourceBlocking(context);
        await ensureNaverLoggedIn(context, accountId, { profilePath: accountCtx.profile_path });
      } else {
        const warmupPage = await acquireWorkflowPage(context);
        await setCrankSessionProgress(
          jobId,
          '워밍업',
          expressWarmup ? '익스프레스(48h 이내 성공)' : '네이버 검색·체류',
        );
        await preSessionWarmup(warmupPage, persona, 'crank', undefined, { express: expressWarmup });
        await releaseWorkflowPage(context, warmupPage);
        await ensurePhoneCrankTether(modemSession.proxyPort);
        await applyCrankResourceBlocking(context);

        await setCrankSessionProgress(jobId, '로그인');
        await naverLogin(context, accountId, {
          profilePath: accountCtx.profile_path,
          captchaContext: {
            humaJobId: jobId,
            accountId,
            workspace: crankWorkspace,
            jobType: 'social_crank',
          },
        });
      }
      const page = await acquireWorkflowPage(context);

      const visitHistory = await loadVisitHistory(accountId);
      const ourBlogUrls =
        payload.ourBlogUrls?.length ? payload.ourBlogUrls : await fetchPostingBlogUrls(crankWorkspace);

      const keywords = selectCrankKeywordsForWorkspace(
        crankWorkspace,
        config.keyword_pools,
        config.keyword_pick_count ?? 4,
      );

      await setCrankSessionProgress(jobId, '블로그 검색', `${keywords.length}개 키워드`);
      const otherCandidates = await searchNaverBlogs(page, keywords, otherTarget * 2, scale);
      const otherUrls = fillVisitUrls(
        filterUrlsByVisitInterval(otherCandidates, visitHistory, config.min_visit_interval_days),
        otherCandidates,
        otherTarget,
      );
      const ourUrls = fillVisitUrls(
        filterUrlsByVisitInterval(shuffleArray(ourBlogUrls), visitHistory, config.min_visit_interval_days),
        shuffleArray(ourBlogUrls),
        ourTarget,
      );

      if (otherTarget > 0 && otherUrls.length === 0 && otherCandidates.length === 0) {
        throw new Error('NO_LINKS_FOUND:session:네이버 블로그 검색');
      }

      // 방문 순서를 셔플 — 항상 '타 블로그 전부 → 자사 블로그' 고정 패턴은 탐지 표면.
      const allTargets: BlogTarget[] = shuffleArray([
        ...buildBlogTargets(otherUrls, persona, false),
        ...buildBlogTargets(ourUrls, persona, true),
      ]).slice(0, maxVisits);

      let likesDone = 0;
      let commentsDone = 0;
      const visitedUrls: string[] = [];
      const sessionDeadline = Date.now() + SESSION_HARD_CAP_MS;

      for (let visitIdx = 0; visitIdx < allTargets.length; visitIdx += 1) {
        const target = allTargets[visitIdx]!;
        if (Date.now() > sessionDeadline) break;
        await setCrankSessionProgress(jobId, '블로그 방문', `${visitIdx + 1}/${allTargets.length}`);
        await page.goto(target.url, {
          waitUntil: 'domcontentloaded',
          timeout: CRANK_NAV_TIMEOUT_MS,
        });
        await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});

        const dwellSec = await quickBlogGlance(page);

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
            dwellSec,
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

        await humanSleep(CRANK_BLOG_GAP_MS[0], CRANK_BLOG_GAP_MS[1]);
      }

      await setCrankSessionProgress(jobId, '마무리');
      await updateVisitHistory(accountId, visitedUrls);
      // 계획 수가 아닌 실제 방문 수로 집계 (deadline 중단·실패 반영)
      await updateCrankCount(accountId, visitedUrls.length);
      await clearCrankSessionProgress(jobId);
    } catch (innerErr) {
      if (
        context &&
        (await tryEnterCrankCaptchaHold({
          err: innerErr,
          humaJobId: options?.humaJobId,
          accountId,
          workspace: crankWorkspace,
          context,
          modemSession,
          releaseAccountLock: options?.releaseAccountLock,
        }))
      ) {
        heldForCaptcha = true;
        await setCrankSessionProgress(jobId, 'CAPTCHA 대기', 'VNC 수동 해결');
        throw new Error(CAPTCHA_AWAITING_HUMAN);
      }
      throw innerErr;
    } finally {
      if (!heldForCaptcha && context) await closeBrowserContext(context);
    }
  } catch (err) {
    if (isCrankCaptchaHoldSignal(err)) throw err;
    if (!heldForCaptcha) await clearCrankSessionProgress(jobId);
    if (isCrankHumanHoldError(err) && !options?.humaJobId) {
      await handleLayer4Detection(accountId, err, modemSession);
    }
    throw err;
  } finally {
    if (!heldForCaptcha && ownsModem && modemSession) await releaseModem(modemSession);
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
        await humanClickLocator(page, commentArea);
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
