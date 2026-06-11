import type { Page } from 'playwright';
import { humanSleep } from '../../human-engine/typing.js';
import { scrollWithReverse } from '../../human-engine/timing.js';
import { randomBetween } from '../../../lib/utils.js';
import type { HumanEngineConfig } from '../../../lib/settings.js';
import type { AccountPersona } from '../persona.js';
import {
  blogSearchUrl,
  collectNaverSearchUrlsDetailed,
  integratedSearchUrl,
} from '../../../lib/naver-search-links.js';
import { CRANK_NAV_TIMEOUT_MS, PLAYWRIGHT_NAV_TIMEOUT_MS } from '../../../lib/playwright-nav-timeout.js';
import { throwWarmupFailure } from '../../../lib/warmup-failure.js';

export type WarmupAccountType = 'posting' | 'crank';

const KEYWORD_POOL: Record<string, string[]> = {
  연애: ['연애고민', '남자친구', '썸', '짝사랑', '재회방법'],
  직업: ['이직방법', '직장생활', '퇴직금', '사업아이디어', '부업추천'],
  건강: ['건강관리', '다이어트', '스트레스해소', '수면부족', '피부관리'],
  재테크: ['주식투자', '부동산', '적금추천', '청약', '절약방법'],
  운세: ['오늘운세', '사주', '타로', '꿈해몽', '신년운세'],
  일상: ['맛집추천', '카페투어', '주말여행', '요리레시피', '드라마추천'],
};

/** 검색 결과 링크 — 들어가자마자 스크롤, 대충 훑고 5~10초 내 이탈 */
async function quickWarmupGlance(page: Page): Promise<void> {
  await humanSleep(300, 900);
  await scrollWithReverse(page, randomBetween(2000, 4500), [250, 650], [120, 400], 0.08);
  await humanSleep(1500, 4000);
}

async function safeWarmupGoto(page: Page, url: string, timeoutMs: number): Promise<boolean> {
  try {
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: timeoutMs,
    });
    return true;
  } catch {
    return false;
  }
}

async function visitWarmupUrls(
  page: Page,
  urls: string[],
  visitCount: number,
  navTimeoutMs: number,
): Promise<void> {
  let visited = 0;
  for (const url of urls) {
    if (visited >= visitCount) break;
    if (!(await safeWarmupGoto(page, url, navTimeoutMs))) continue;
    visited += 1;
    await quickWarmupGlance(page);
    await page.goBack({ waitUntil: 'domcontentloaded', timeout: navTimeoutMs }).catch(() => {});
    await humanSleep(1000, 2500);
  }
}

/** 검색 결과 페이지 로드 — 실패 시 navError 반환 */
async function openSearchResults(
  page: Page,
  url: string,
  timeoutMs = PLAYWRIGHT_NAV_TIMEOUT_MS,
): Promise<string | null> {
  try {
    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: timeoutMs,
    });
    if (response && response.status() >= 400) {
      return `HTTP ${response.status()}`;
    }
    await page.waitForLoadState('networkidle', { timeout: 4_000 }).catch(() => {});
    await humanSleep(600, 1200);
    return null;
  } catch (err) {
    return (err as Error).message || 'navigation_failed';
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

export type PreSessionWarmupOptions = {
  /** 최근 성공 세션(48h) — 통합검색 1곳·짧은 체류, 블로그 워밍업 생략 */
  express?: boolean;
};

export async function preSessionWarmup(
  page: Page,
  persona: AccountPersona,
  accountType: WarmupAccountType,
  _humanEngine?: HumanEngineConfig,
  options?: PreSessionWarmupOptions,
): Promise<void> {
  const navTimeout =
    accountType === 'crank' ? CRANK_NAV_TIMEOUT_MS : PLAYWRIGHT_NAV_TIMEOUT_MS;
  const keyword = selectWarmupKeyword(persona);
  const navError = await openSearchResults(page, integratedSearchUrl(keyword), navTimeout);

  const expressCrank = accountType === 'crank' && options?.express === true;
  const visitCount =
    accountType === 'posting'
      ? randomBetween(2, 3)
      : expressCrank
        ? randomBetween(1, 2)
        : randomBetween(2, 4);

  const integrated = await collectNaverSearchUrlsDetailed(page, 'integrated', 8);
  if (navError || integrated.urls.length === 0) {
    await throwWarmupFailure(page, '네이버 검색 결과', integrated.diagnostics, navError);
  }

  await visitWarmupUrls(page, integrated.urls, visitCount, navTimeout);

  if (accountType === 'crank' && !expressCrank) {
    const blogKeyword = selectWarmupKeyword(persona);
    const blogNavError = await openSearchResults(page, blogSearchUrl(blogKeyword), navTimeout);

    const blog = await collectNaverSearchUrlsDetailed(page, 'blog', 4);
    if (blogNavError || blog.urls.length === 0) {
      await throwWarmupFailure(page, '네이버 블로그 검색', blog.diagnostics, blogNavError);
    }

    await visitWarmupUrls(page, blog.urls, randomBetween(1, 2), navTimeout);
  }
}
