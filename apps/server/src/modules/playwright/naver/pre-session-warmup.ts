import type { Page } from 'playwright';
import { humanType, humanSleep } from '../../human-engine/typing.js';
import { humanClickLocator } from '../../human-engine/mouse.js';
import { scrollWithReverse } from '../../human-engine/timing.js';
import { randomBetween } from '../../../lib/utils.js';
import type { HumanEngineConfig } from '../../../lib/settings.js';
import type { AccountPersona } from '../persona.js';
import { getHumanEngineConfig } from '../../../lib/settings.js';
import { notifySlack } from '../../watcher/detector.js';

export type WarmupAccountType = 'posting' | 'crank';

/** 네이버 통합 검색 — DOM 변경 대비 복수 셀렉터 */
const SEARCH_LINK_SELECTORS = [
  'a.api_txt_lines.total_tit',
  '.view_wrap a.api_txt_lines',
  '.total_wrap a.api_txt_lines',
  '.news_wrap a[href^="http"]',
  'a.link_tit[href^="http"]',
  '.fds-comps-lib-body a[href^="http"]',
];

/** 네이버 블로그 탭 검색 */
const BLOG_LINK_SELECTORS = [
  'a.api_txt_lines.total_tit',
  '.total_tit a[href*="blog.naver.com"]',
  '.view_wrap a[href*="blog.naver.com"]',
  '.total_wrap a[href*="blog.naver.com"]',
  'a[href*="blog.naver.com/"]',
];

const KEYWORD_POOL: Record<string, string[]> = {
  연애: ['연애고민', '남자친구', '썸', '짝사랑', '재회방법'],
  직업: ['이직방법', '직장생활', '퇴직금', '사업아이디어', '부업추천'],
  건강: ['건강관리', '다이어트', '스트레스해소', '수면부족', '피부관리'],
  재테크: ['주식투자', '부동산', '적금추천', '청약', '절약방법'],
  운세: ['오늘운세', '사주', '타로', '꿈해몽', '신년운세'],
  일상: ['맛집추천', '카페투어', '주말여행', '요리레시피', '드라마추천'],
};

function normalizeHref(href: string | null | undefined): string | null {
  if (!href?.trim()) return null;
  const h = href.trim();
  if (h.startsWith('http://') || h.startsWith('https://')) return h;
  if (h.startsWith('//')) return `https:${h}`;
  if (h.startsWith('/')) return `https://search.naver.com${h}`;
  return null;
}

/** 여러 셀렉터에서 http(s) 링크 URL 수집 */
async function collectPageUrls(
  page: Page,
  selectors: string[],
  filter: (url: string) => boolean,
  max: number,
): Promise<string[]> {
  const urls: string[] = [];
  for (const selector of selectors) {
    const links = page.locator(selector);
    const count = await links.count();
    for (let i = 0; i < count && urls.length < max; i++) {
      const href = normalizeHref(await links.nth(i).getAttribute('href'));
      if (!href || !filter(href) || urls.includes(href)) continue;
      urls.push(href);
    }
    if (urls.length >= max) break;
  }
  return urls;
}

async function failWarmupNoLinks(context: string): Promise<never> {
  const message = `워밍업 실패: ${context} — 검색 결과 링크 없음 (NO_LINKS_FOUND)`;
  await notifySlack(message);
  throw new Error(`NO_LINKS_FOUND:warmup:${context}`);
}

async function warmupStayScroll(page: Page, durationMs: number): Promise<void> {
  await scrollWithReverse(page, durationMs, [300, 800], [2000, 5000], 0.2);
}

async function visitWarmupUrls(
  page: Page,
  urls: string[],
  visitCount: number,
  stayMin: number,
  stayMax: number,
): Promise<void> {
  for (const url of urls.slice(0, visitCount)) {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await humanSleep(stayMin, stayMax);
    await warmupStayScroll(page, randomBetween(4000, 12000));
    await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {});
    await humanSleep(2000, 4000);
  }
}

/** v3.25 §7-14-1 — posting·crank 세션 진입 전 필수 워밍업 */
export function selectWarmupKeyword(persona: AccountPersona): string {
  const age = persona.age || 30;
  let categories: string[];
  if (age < 25) categories = ['연애', '일상', '운세', '재테크'];
  else if (age < 35) categories = ['연애', '직업', '재테크', '운세', '일상'];
  else if (age < 45) categories = ['직업', '재테크', '건강', '운세', '일상'];
  else categories = ['건강', '재테크', '운세', '일상'];

  const category = categories[Math.floor(Math.random() * categories.length)] ?? '일상';
  const pool = KEYWORD_POOL[category] ?? KEYWORD_POOL['일상'];
  if (persona.interests.length) {
    return persona.interests[Math.floor(Math.random() * persona.interests.length)] ?? pool[0];
  }
  return pool[Math.floor(Math.random() * pool.length)] ?? '운세';
}

export async function preSessionWarmup(
  page: Page,
  persona: AccountPersona,
  accountType: WarmupAccountType,
  humanEngine?: HumanEngineConfig,
): Promise<void> {
  const config = humanEngine ?? (await getHumanEngineConfig());

  await page.goto('https://www.naver.com', { waitUntil: 'domcontentloaded' });
  await humanSleep(3000, 8000);

  const keyword = selectWarmupKeyword(persona);
  const searchBox = page.locator('#query');
  await humanClickLocator(page, searchBox, undefined, [300, 800]);
  await humanType(page, searchBox, keyword, config);
  await humanSleep(500, 1500);
  await page.keyboard.press('Enter');
  await page.waitForLoadState('networkidle').catch(() => {});
  await humanSleep(2000, 4000);

  const visitCount =
    accountType === 'posting' ? randomBetween(1, 2) : randomBetween(2, 3);
  const stayMin = accountType === 'posting' ? 15000 : 60000;
  const stayMax = accountType === 'posting' ? 45000 : 180000;

  let searchUrls = await collectPageUrls(
    page,
    SEARCH_LINK_SELECTORS,
    (u) => !u.includes('blog.naver.com'),
    6,
  );

  if (searchUrls.length === 0) {
    await page.mouse.wheel(0, 400);
    await humanSleep(1000, 2000);
    searchUrls = await collectPageUrls(
      page,
      SEARCH_LINK_SELECTORS,
      (u) => !u.includes('blog.naver.com'),
      6,
    );
  }

  if (searchUrls.length === 0) {
    await failWarmupNoLinks('네이버 검색 결과');
  }

  await visitWarmupUrls(page, searchUrls, visitCount, stayMin, stayMax);

  if (accountType === 'crank') {
    const blogKeyword = selectWarmupKeyword(persona);
    await page.goto(
      `https://search.naver.com/search.naver?where=blog&query=${encodeURIComponent(blogKeyword)}`,
      { waitUntil: 'domcontentloaded' },
    );
    await page.waitForLoadState('networkidle').catch(() => {});
    await humanSleep(2000, 4000);

    let blogUrls = await collectPageUrls(
      page,
      BLOG_LINK_SELECTORS,
      (u) => u.includes('blog.naver.com'),
      3,
    );

    if (blogUrls.length === 0) {
      await page.mouse.wheel(0, 400);
      await humanSleep(1000, 2000);
      blogUrls = await collectPageUrls(
        page,
        BLOG_LINK_SELECTORS,
        (u) => u.includes('blog.naver.com'),
        3,
      );
    }

    if (blogUrls.length === 0) {
      await failWarmupNoLinks('네이버 블로그 검색');
    }

    await page.goto(blogUrls[0], { waitUntil: 'domcontentloaded' });
    await humanSleep(60000, 120000);
    await warmupStayScroll(page, randomBetween(8000, 20000));
    await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {});
    await humanSleep(2000, 4000);
  }
}
