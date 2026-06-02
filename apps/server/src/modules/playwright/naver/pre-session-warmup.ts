import type { Locator, Page } from 'playwright';
import { humanType, humanSleep } from '../../human-engine/typing.js';
import { humanClickLocator, humanNavigateViaLink } from '../../human-engine/mouse.js';
import { scrollWithReverse } from '../../human-engine/timing.js';
import { randomBetween } from '../../../lib/utils.js';
import type { HumanEngineConfig } from '../../../lib/settings.js';
import type { AccountPersona } from '../persona.js';
import { getHumanEngineConfig } from '../../../lib/settings.js';
import { notifySlack } from '../../watcher/detector.js';

export type WarmupAccountType = 'posting' | 'crank';

const RESULT_LINK_SELECTOR = '.news_wrap a, .total_wrap .link_tit, .view_wrap .api_txt_lines';
const BLOG_RESULT_SELECTOR = '.total_wrap .api_txt_lines';

const KEYWORD_POOL: Record<string, string[]> = {
  연애: ['연애고민', '남자친구', '썸', '짝사랑', '재회방법'],
  직업: ['이직방법', '직장생활', '퇴직금', '사업아이디어', '부업추천'],
  건강: ['건강관리', '다이어트', '스트레스해소', '수면부족', '피부관리'],
  재테크: ['주식투자', '부동산', '적금추천', '청약', '절약방법'],
  운세: ['오늘운세', '사주', '타로', '꿈해몽', '신년운세'],
  일상: ['맛집추천', '카페투어', '주말여행', '요리레시피', '드라마추천'],
};

async function collectHttpLinkIndices(links: Locator, max: number): Promise<number[]> {
  const count = await links.count();
  const indices: number[] = [];
  for (let i = 0; i < count && indices.length < max; i++) {
    const href = await links.nth(i).getAttribute('href');
    if (href?.startsWith('http')) indices.push(i);
  }
  return indices;
}

async function failWarmupNoLinks(context: string): Promise<never> {
  const message = `워밍업 실패: ${context} — 검색 결과 링크 없음 (WARMUP_NO_LINKS_FOUND)`;
  await notifySlack(message);
  throw new Error('WARMUP_NO_LINKS_FOUND');
}

async function warmupStayScroll(page: Page, durationMs: number): Promise<void> {
  await scrollWithReverse(page, durationMs, [300, 800], [2000, 5000], 0.2);
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

  await page.goto('https://www.naver.com');
  await humanSleep(3000, 8000);

  const keyword = selectWarmupKeyword(persona);
  const searchBox = page.locator('#query');
  await humanClickLocator(page, searchBox, undefined, [300, 800]);
  await humanType(page, searchBox, keyword, config);
  await humanSleep(500, 1500);
  await page.keyboard.press('Enter');
  await humanSleep(2000, 4000);

  const visitCount =
    accountType === 'posting' ? randomBetween(1, 2) : randomBetween(2, 3);
  const stayMin = accountType === 'posting' ? 15000 : 60000;
  const stayMax = accountType === 'posting' ? 45000 : 180000;

  const resultLinks = page.locator(RESULT_LINK_SELECTOR);
  const linkIndices = await collectHttpLinkIndices(resultLinks, 6);
  if (linkIndices.length === 0) {
    await failWarmupNoLinks('네이버 검색 결과');
  }

  for (let i = 0; i < Math.min(visitCount, linkIndices.length); i++) {
    const link = resultLinks.nth(linkIndices[i]);
    await humanNavigateViaLink(page, link);
    await humanSleep(stayMin, stayMax);
    await warmupStayScroll(page, randomBetween(4000, 12000));
    await page.goBack({ waitUntil: 'networkidle' }).catch(() => {});
    await humanSleep(2000, 4000);
  }

  if (accountType === 'crank') {
    const blogKeyword = selectWarmupKeyword(persona);
    await page.goto(
      `https://search.naver.com/search.naver?where=blog&query=${encodeURIComponent(blogKeyword)}`,
    );
    await humanSleep(2000, 4000);

    const blogLinks = page.locator(BLOG_RESULT_SELECTOR);
    const blogIndices: number[] = [];
    const blogCount = await blogLinks.count();
    for (let i = 0; i < blogCount && blogIndices.length < 3; i++) {
      const href = await blogLinks.nth(i).getAttribute('href');
      if (href?.includes('blog.naver.com')) blogIndices.push(i);
    }
    if (blogIndices.length === 0) {
      await failWarmupNoLinks('네이버 블로그 검색 결과');
    }

    const blogLink = blogLinks.nth(blogIndices[0]);
    await humanNavigateViaLink(page, blogLink);
    await humanSleep(60000, 120000);
    await warmupStayScroll(page, randomBetween(8000, 20000));
    await page.goBack({ waitUntil: 'networkidle' }).catch(() => {});
    await humanSleep(2000, 4000);
  }
}
