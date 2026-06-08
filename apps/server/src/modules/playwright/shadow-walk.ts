import type { Page } from 'playwright';
import { PLAYWRIGHT_NAV_TIMEOUT_MS } from '../../lib/playwright-nav-timeout.js';
import { humanSleep } from '../human-engine/typing.js';

/** LTE SOCKS에서도 domcontentloaded 도달 가능한 가벼운 사이트만 */
const SHADOW_SITES = ['https://www.daum.net', 'https://news.naver.com', 'https://www.naver.com'];

export async function shadowWalk(page: Page) {
  const sites = [...SHADOW_SITES]
    .sort(() => Math.random() - 0.5)
    .slice(0, Math.floor(Math.random() * 2) + 2);

  const shadowTimeout = Math.min(PLAYWRIGHT_NAV_TIMEOUT_MS, 45_000);
  for (const site of sites) {
    await page.goto(site, { waitUntil: 'domcontentloaded', timeout: shadowTimeout }).catch(() => {});
    await humanSleep(500, 1500);
  }
}
