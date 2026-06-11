import type { Page } from 'playwright';
import { humanSleep } from '../../human-engine/typing.js';
import { scrollWithReverse } from '../../human-engine/timing.js';
import { randomBetween } from '../../../lib/utils.js';
import type { HumanEngineConfig } from '../../../lib/settings.js';
import type { AccountPersona } from '../persona.js';
import { collectNaverSearchUrlsDetailed } from '../../../lib/naver-search-links.js';
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
  육아: ['육아템', '아기수면', '이유식', '어린이집', '육아스트레스'],
};

const SEARCH_TAB_LABELS = ['뉴스', '블로그', '카페', '지식iN', '이미지'] as const;

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function ageCategories(age: number): string[] {
  if (age < 25) return ['연애', '일상', '운세', '재테크'];
  if (age < 35) return ['연애', '직업', '재테크', '운세', '일상'];
  if (age < 45) return ['직업', '재테크', '건강', '운세', '일상'];
  return ['건강', '재테크', '운세', '일상'];
}

/** 세션마다 페르소나·연령 기반 키워드 여러 개 (관심사 1개만 반복하지 않음) */
export function selectWarmupKeywords(persona: AccountPersona, count: number): string[] {
  const age = persona.age || 30;
  const categories = ageCategories(age);
  const pool = shuffle(
    categories.flatMap((cat) => KEYWORD_POOL[cat] ?? []).filter(Boolean),
  );

  const fromInterests = (persona.interests ?? [])
    .map((s) => s?.trim())
    .filter(Boolean) as string[];

  const candidates = shuffle([
    ...pool,
    ...fromInterests,
    ...fromInterests.flatMap((interest) => {
      const related: string[] = [interest];
      for (const cat of categories) {
        for (const kw of KEYWORD_POOL[cat] ?? []) {
          if (kw !== interest) related.push(kw);
        }
      }
      return related.slice(0, 4);
    }),
  ]);

  const picked: string[] = [];
  for (const kw of candidates) {
    if (picked.length >= count) break;
    if (!picked.includes(kw)) picked.push(kw);
  }
  let guard = 0;
  while (picked.length < count && guard < count * 4) {
    guard += 1;
    const fallback = pool[guard % Math.max(1, pool.length)] ?? '운세';
    if (!picked.includes(fallback)) picked.push(fallback);
  }
  return picked.slice(0, count);
}

/** @deprecated 단일 키워드 — selectWarmupKeywords 사용 */
export function selectWarmupKeyword(persona: AccountPersona): string {
  return selectWarmupKeywords(persona, 1)[0] ?? '운세';
}

async function quickWarmupGlance(page: Page, accountType: WarmupAccountType): Promise<void> {
  await humanSleep(accountType === 'posting' ? 400 : 300, accountType === 'posting' ? 1200 : 900);
  await scrollWithReverse(
    page,
    randomBetween(accountType === 'posting' ? 800 : 2000, accountType === 'posting' ? 2200 : 4500),
    [150, 400],
    accountType === 'posting' ? [200, 500] : [120, 400],
    accountType === 'posting' ? 0.12 : 0.08,
  );
  await humanSleep(accountType === 'posting' ? 300 : 1500, accountType === 'posting' ? 1000 : 4000);
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
  accountType: WarmupAccountType,
): Promise<void> {
  let visited = 0;
  for (const url of urls) {
    if (visited >= visitCount) break;
    if (!(await safeWarmupGoto(page, url, navTimeoutMs))) continue;
    visited += 1;
    await quickWarmupGlance(page, accountType);
    await page.goBack({ waitUntil: 'domcontentloaded', timeout: navTimeoutMs }).catch(() => {});
    await humanSleep(accountType === 'posting' ? 250 : 1000, accountType === 'posting' ? 800 : 2500);
  }
}

async function openNaverHome(page: Page, timeoutMs: number): Promise<string | null> {
  try {
    const response = await page.goto('https://www.naver.com', {
      waitUntil: 'domcontentloaded',
      timeout: timeoutMs,
    });
    if (response && response.status() >= 400) return `HTTP ${response.status()}`;
    await humanSleep(300, 600);
    return null;
  } catch (err) {
    return (err as Error).message || 'navigation_failed';
  }
}

async function openNaverHomeWithRetry(page: Page, timeoutMs: number, maxAttempts = 3): Promise<string | null> {
  let lastErr: string | null = null;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    lastErr = await openNaverHome(page, timeoutMs);
    const url = page.url().toLowerCase();
    if (!lastErr && url.includes('naver.com') && !url.startsWith('chrome-error://')) {
      return null;
    }
    if (!lastErr && url.startsWith('chrome-error://')) {
      lastErr = 'chrome_error_page';
    }
    if (attempt < maxAttempts - 1) {
      await humanSleep(800, 1500);
    }
  }
  return lastErr;
}

/** naver.com 검색창에 키워드 입력 후 Enter (URL 직접 조합 금지) */
async function searchViaNaverHomepage(
  page: Page,
  keyword: string,
  timeoutMs: number,
  humanEngine?: HumanEngineConfig,
): Promise<string | null> {
  const homeErr = await openNaverHomeWithRetry(page, timeoutMs);
  if (homeErr) return homeErr;

  const searchBox = page.locator('#query, input[name="query"]').first();
  if (!(await searchBox.isVisible({ timeout: 5000 }).catch(() => false))) {
    return 'search_box_not_found';
  }

  await searchBox.click({ timeout: 5000 }).catch(() => {});
  await humanSleep(150, 350);
  await searchBox.fill('');
  // humanType(humanClick)는 검색창 bbox 유실 시 HUMAN_CLICK_NO_BBOX — 워밍업은 pressSequentially만
  await searchBox.pressSequentially(keyword, { delay: randomBetween(45, 95) });
  await humanSleep(200, 450);
  await searchBox.press('Enter');
  try {
    await page.waitForLoadState('domcontentloaded', { timeout: timeoutMs });
    await humanSleep(400, 800);
    return null;
  } catch (err) {
    return (err as Error).message || 'search_navigation_failed';
  }
}

/** 검색 결과 탭(블로그·뉴스·지식iN 등) 중 하나 클릭 */
async function maybeClickSearchTab(page: Page): Promise<void> {
  const tab = SEARCH_TAB_LABELS[Math.floor(Math.random() * SEARCH_TAB_LABELS.length)];
  const tabLink = page
    .locator('.tab_menu a, .api_ani_send a, a[role="tab"]')
    .filter({ hasText: tab })
    .first();
  if (await tabLink.isVisible({ timeout: 1500 }).catch(() => false)) {
    await tabLink.click({ timeout: 5000 }).catch(() => {});
    await page.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => {});
    await humanSleep(350, 700);
  }
}

async function runWarmupSearchRound(
  page: Page,
  keyword: string,
  navTimeout: number,
  accountType: WarmupAccountType,
  visitCount: number,
  humanEngine?: HumanEngineConfig,
  failOnEmpty = false,
): Promise<void> {
  const maxAttempts = failOnEmpty ? 2 : 1;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const navError = await searchViaNaverHomepage(page, keyword, navTimeout, humanEngine);
    if (Math.random() < 0.55) await maybeClickSearchTab(page);

    const integrated = await collectNaverSearchUrlsDetailed(page, 'integrated', 8);
    if (!navError && integrated.urls.length > 0) {
      await visitWarmupUrls(page, integrated.urls, visitCount, navTimeout, accountType);
      return;
    }
    if (failOnEmpty && attempt < maxAttempts - 1) {
      await humanSleep(1000, 2000);
      continue;
    }
    if (failOnEmpty) {
      await throwWarmupFailure(page, '네이버 검색 결과', integrated.diagnostics, navError);
    }
    return;
  }
}

export type PreSessionWarmupOptions = {
  /** 최근 성공 세션(48h) — 통합검색 1곳·짧은 체류, 블로그 워밍업 생략 */
  express?: boolean;
};

export async function preSessionWarmup(
  page: Page,
  persona: AccountPersona,
  accountType: WarmupAccountType,
  humanEngine?: HumanEngineConfig,
  options?: PreSessionWarmupOptions,
): Promise<void> {
  const navTimeout =
    accountType === 'crank' ? CRANK_NAV_TIMEOUT_MS : PLAYWRIGHT_NAV_TIMEOUT_MS;
  const expressCrank = accountType === 'crank' && options?.express === true;

  const roundCount =
    accountType === 'posting'
      ? randomBetween(2, 3)
      : expressCrank
        ? 1
        : randomBetween(2, 3);

  const keywords = selectWarmupKeywords(persona, roundCount + 1);
  const visitPerRound =
    accountType === 'posting'
      ? randomBetween(2, 3)
      : expressCrank
        ? randomBetween(1, 2)
        : randomBetween(2, 3);

  for (let i = 0; i < roundCount; i += 1) {
    await runWarmupSearchRound(
      page,
      keywords[i] ?? selectWarmupKeyword(persona),
      navTimeout,
      accountType,
      visitPerRound,
      humanEngine,
      i === 0,
    );
    if (i < roundCount - 1) {
      await openNaverHome(page, navTimeout).catch(() => null);
      await humanSleep(300, 700);
    }
  }

  if (accountType === 'posting') {
    const blogKeyword = keywords[roundCount] ?? selectWarmupKeyword(persona);
    const navError = await searchViaNaverHomepage(page, blogKeyword, navTimeout, humanEngine);
    await maybeClickSearchTab(page);
    const blogTab = page.locator('.tab_menu a, a[role="tab"]').filter({ hasText: '블로그' }).first();
    if (await blogTab.isVisible({ timeout: 1500 }).catch(() => false)) {
      await blogTab.click({ timeout: 5000 }).catch(() => {});
      await page.waitForLoadState('domcontentloaded', { timeout: navTimeout }).catch(() => {});
      await humanSleep(350, 700);
    }
    const blog = await collectNaverSearchUrlsDetailed(page, 'blog', 4);
    if (!navError && blog.urls.length > 0) {
      await visitWarmupUrls(page, blog.urls, randomBetween(1, 2), navTimeout, accountType);
    }
  } else if (accountType === 'crank' && !expressCrank) {
    const blogKeyword = keywords[roundCount] ?? selectWarmupKeyword(persona);
    await runWarmupSearchRound(page, blogKeyword, navTimeout, accountType, randomBetween(1, 2), humanEngine, false);
  }
}
