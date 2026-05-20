import type { Page, BrowserContext } from 'playwright';
import { supabase } from '../../../middleware/auth.js';
import { getSetting } from '../../../lib/settings.js';
import { createBrowser } from '../browser.js';
import { naverLogin } from './login.js';
import { humanSleep } from '../../human-engine/typing.js';
import { humanType } from '../../human-engine/typing.js';
import { scrollRead } from '../../human-engine/timing.js';
import { randomBetween, shuffleArray, sleep } from '../../../lib/utils.js';
import { getHumanEngineConfig } from '../../../lib/settings.js';

const COMMENT_TEMPLATES = [
  '정말 유익한 글이네요! 많은 도움이 됐습니다',
  '이런 좋은 정보 감사해요. 앞으로도 좋은 글 부탁드려요!',
  '공감되는 내용이에요. 자주 놀러올게요',
  '글을 읽고 많이 배웠습니다. 감사합니다!',
];

function generateCrankComment(): string {
  return COMMENT_TEMPLATES[Math.floor(Math.random() * COMMENT_TEMPLATES.length)];
}

export async function runSocialCrank(
  accountId: string,
  payload: { ourBlogUrls: string[]; targetDate?: string }
) {
  const config = await getSetting('social_crank', {
    visits_per_session: 15,
    keywords: ['사주풀이', '꿈해몽', '신년운세'],
  });
  const proxyPort = await getModemProxyPort(accountId);
  const { browser, context } = await createBrowser(proxyPort);

  try {
    await naverLogin(context, accountId);
    const page = await context.newPage();

    const ourBlogs = await selectOurBlogsToVisit(accountId, payload.ourBlogUrls);
    const otherBlogs = await searchRelatedBlogs(page, config.keywords, config.visits_per_session - ourBlogs.length);
    const allTargets = shuffleArray([...ourBlogs, ...otherBlogs]);

    for (const target of allTargets) {
      await visitBlog(page, target);
      await humanSleep(30000, 120000);
    }

    await updateVisitHistory(accountId, ourBlogs.map((b) => b.url));
    await updateCrankCount(accountId, allTargets.length);
  } finally {
    await browser.close();
  }
}

async function getModemProxyPort(accountId: string): Promise<number | undefined> {
  const { data } = await supabase
    .from('huma_accounts')
    .select('proxy_port, modem_id, huma_modems(proxy_port)')
    .eq('id', accountId)
    .single();
  return data?.proxy_port ?? undefined;
}

async function visitBlog(
  page: Page,
  target: { url: string; isOurBlog: boolean; doLike: boolean; doComment: boolean; commentText?: string }
) {
  await page.goto(target.url);
  await page.waitForLoadState('networkidle');
  await scrollRead(page, randomBetween(60000, 180000));

  if (target.doLike) {
    const likeBtn = page.locator('.u_likeit_list_btn');
    if (await likeBtn.isVisible()) {
      await humanSleep(2000, 5000);
      await likeBtn.click();
    }
  }

  if (target.doComment && target.commentText) {
    const commentArea = page.locator('.u_cbox_write_wrap textarea');
    if (await commentArea.isVisible()) {
      await humanSleep(5000, 15000);
      await commentArea.click();
      const humanConfig = await getHumanEngineConfig();
      await humanType(page, commentArea, target.commentText, humanConfig);
      await humanSleep(2000, 5000);
      await page.locator('.u_cbox_btn_upload').click();
    }
  }
}

async function selectOurBlogsToVisit(accountId: string, ourBlogUrls: string[]) {
  const { data: account } = await supabase
    .from('huma_accounts')
    .select('last_visited_our_blog')
    .eq('id', accountId)
    .single();

  const visitHistory = (account?.last_visited_our_blog as Record<string, string>) || {};
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);

  return ourBlogUrls
    .filter((url) => {
      const lastVisit = visitHistory[url];
      return !lastVisit || new Date(lastVisit) < threeDaysAgo;
    })
    .map((url) => ({
      url,
      isOurBlog: true,
      doLike: Math.random() < 0.9,
      doComment: Math.random() < 0.3,
      commentText: generateCrankComment(),
    }));
}

async function searchRelatedBlogs(page: Page, keywords: string[], count: number) {
  const keyword = keywords[Math.floor(Math.random() * keywords.length)];
  await page.goto(`https://search.naver.com/search.naver?where=post&query=${encodeURIComponent(keyword)}`);
  await page.waitForLoadState('networkidle');
  await humanSleep(2000, 4000);

  const links = await page.locator('.detail_box .sub_txt a').all();
  const urls: string[] = [];
  for (const link of links.slice(0, count + 5)) {
    const href = await link.getAttribute('href');
    if (href?.includes('blog.naver.com')) urls.push(href);
  }

  return shuffleArray(urls)
    .slice(0, count)
    .map((url) => ({
      url,
      isOurBlog: false,
      doLike: Math.random() < 0.4,
      doComment: false,
    }));
}

async function updateVisitHistory(accountId: string, urls: string[]) {
  const { data: account } = await supabase
    .from('huma_accounts')
    .select('last_visited_our_blog')
    .eq('id', accountId)
    .single();

  const history = { ...(account?.last_visited_our_blog as Record<string, string>), ...Object.fromEntries(urls.map((u) => [u, new Date().toISOString()])) };
  await supabase.from('huma_accounts').update({ last_visited_our_blog: history }).eq('id', accountId);
}

async function updateCrankCount(accountId: string, count: number) {
  const { data } = await supabase.from('huma_accounts').select('crank_count_today').eq('id', accountId).single();
  await supabase
    .from('huma_accounts')
    .update({ crank_count_today: (data?.crank_count_today ?? 0) + count })
    .eq('id', accountId);
}
