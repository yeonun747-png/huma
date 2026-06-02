import type { Page } from 'playwright';
import { randomBetween, sleep } from './utils.js';

export async function resolveCafeClubId(page: Page, slug: string): Promise<string | null> {
  await page.goto(`https://cafe.naver.com/${slug}`, { waitUntil: 'domcontentloaded' });
  await sleep(randomBetween(1500, 3000));

  const clubId = await page
    .evaluate(() => {
      const w = window as unknown as { g_sClubId?: string };
      if (w.g_sClubId && /^\d+$/.test(w.g_sClubId)) return w.g_sClubId;

      const iframe = document.querySelector('#cafe_main') as HTMLIFrameElement | null;
      if (iframe?.src) {
        const m = iframe.src.match(/clubid=(\d+)/i);
        if (m) return m[1];
      }

      const html = document.documentElement.innerHTML;
      const patterns = [/g_sClubId\s*=\s*['"](\d+)['"]/, /"clubId"\s*:\s*(\d+)/, /clubid[=:]["']?(\d{5,})/i];
      for (const re of patterns) {
        const m = html.match(re);
        if (m) return m[1];
      }
      return null;
    })
    .catch(() => null);

  return clubId;
}

export async function findCafeBoardMenuId(
  page: Page,
  slug: string,
  boardPattern: RegExp,
): Promise<string | null> {
  await page.goto(`https://cafe.naver.com/${slug}`, { waitUntil: 'domcontentloaded' });
  await sleep(randomBetween(1500, 2500));

  const frame = page.frame({ name: 'cafe_main' });
  const targets = frame ? [frame, page] : [page];

  for (const target of targets) {
    const menuId = await target
      .$$eval('a[href*="menuid="], a[href*="MenuId="]', (els, patternStr) => {
        const pattern = new RegExp(patternStr, 'i');
        for (const el of els) {
          const a = el as HTMLAnchorElement;
          const text = (a.textContent ?? '').trim();
          const href = a.href ?? '';
          if (!pattern.test(text)) continue;
          const m = href.match(/menuid=(\d+)/i);
          if (m) return m[1];
        }
        return null;
      }, boardPattern.source)
      .catch(() => null);

    if (menuId) return menuId;
  }

  return null;
}

/** 자유·고민·일반 게시판 (자문자답용) */
export const FREE_BOARD_PATTERN = /자유|수다|고민|질문|얘기|토크|일반/;
export const GREETING_BOARD_PATTERN = /가입인사|인사말|자기소개|신입|환영/;
