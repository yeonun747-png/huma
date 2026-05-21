import type { Page } from 'playwright';
import { humanSleep } from '../human-engine/typing.js';

const SHADOW_SITES = [
  'https://namu.wiki',
  'https://www.daum.net',
  'https://www.tistory.com',
  'https://news.naver.com',
];

export async function shadowWalk(page: Page) {
  const sites = [...SHADOW_SITES]
    .sort(() => Math.random() - 0.5)
    .slice(0, Math.floor(Math.random() * 2) + 2);

  for (const site of sites) {
    await page.goto(site, { waitUntil: 'domcontentloaded', timeout: 8000 }).catch(() => {});
    await humanSleep(500, 1500);
  }
}
