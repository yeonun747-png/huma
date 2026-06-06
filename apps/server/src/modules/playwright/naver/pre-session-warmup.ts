import type { Page } from 'playwright';
import { humanSleep } from '../../human-engine/typing.js';
import { scrollWithReverse } from '../../human-engine/timing.js';
import { randomBetween } from '../../../lib/utils.js';
import type { HumanEngineConfig } from '../../../lib/settings.js';
import type { AccountPersona } from '../persona.js';
import { notifySlack } from '../../watcher/detector.js';
import {
  blogSearchUrl,
  collectNaverSearchUrls,
  integratedSearchUrl,
} from '../../../lib/naver-search-links.js';

export type WarmupAccountType = 'posting' | 'crank';

const KEYWORD_POOL: Record<string, string[]> = {
  연애: ['연애고민', '남자친구', '썸', '짝사랑', '재회방법'],
  직업: ['이직방법', '직장생활', '퇴직금', '사업아이디어', '부업추천'],
  건강: ['건강관리', '다이어트', '스트레스해소', '수면부족', '피부관리'],
  재테크: ['주식투자', '부동산', '적금추천', '청약', '절약방법'],
  운세: ['오늘운세', '사주', '타로', '꿈해몽', '신년운세'],
  일상: ['맛집추천', '카페투어', '주말여행', '요리레시피', '드라마추천'],
};

async function failWarmupNoLinks(page: Page, context: string): Promise<never> {
  const url = page.url();
  const title = (await page.title().catch(() => '')).slice(0, 80);
  const message = `워밍업 실패: ${context} — 검색 결과 링크 없음 (NO_LINKS_FOUND) · ${url} · ${title}`;
  await notifySlack(message);
  throw new Error(`NO_LINKS_FOUND:warmup:${context}|url=${url}|title=${title}`);
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

async function openSearchResults(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => {});
  await humanSleep(2000, 4000);
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
  _humanEngine?: HumanEngineConfig,
): Promise<void> {
  const keyword = selectWarmupKeyword(persona);
  await openSearchResults(page, integratedSearchUrl(keyword));

  const visitCount =
    accountType === 'posting' ? randomBetween(1, 2) : randomBetween(2, 3);
  const stayMin = accountType === 'posting' ? 15000 : 60000;
  const stayMax = accountType === 'posting' ? 45000 : 180000;

  const searchUrls = await collectNaverSearchUrls(page, 'integrated', 6);
  if (searchUrls.length === 0) {
    await failWarmupNoLinks(page, '네이버 검색 결과');
  }

  await visitWarmupUrls(page, searchUrls, visitCount, stayMin, stayMax);

  if (accountType === 'crank') {
    const blogKeyword = selectWarmupKeyword(persona);
    await openSearchResults(page, blogSearchUrl(blogKeyword));

    const blogUrls = await collectNaverSearchUrls(page, 'blog', 3);
    if (blogUrls.length === 0) {
      await failWarmupNoLinks(page, '네이버 블로그 검색');
    }

    await page.goto(blogUrls[0]!, { waitUntil: 'domcontentloaded' });
    await humanSleep(60000, 120000);
    await warmupStayScroll(page, randomBetween(8000, 20000));
    await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {});
    await humanSleep(2000, 4000);
  }
}
