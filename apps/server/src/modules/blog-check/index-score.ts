import type { Page } from 'playwright';
import { sleep } from '../../lib/utils.js';

export interface BlogStats {
  visitorCount: number;
  buddyCount: number;
  postCount: number;
}

/** idx = (방문자/1000×0.5) + (이웃/100×0.3) + (게시글/100×0.2), 최대 10.0 */
export function computeBlogIndexScore(stats: BlogStats): number {
  const raw =
    (stats.visitorCount / 1000) * 0.5 +
    (stats.buddyCount / 100) * 0.3 +
    (stats.postCount / 100) * 0.2;
  return Math.min(10, Math.round(raw * 10) / 10);
}

function parseCount(raw: string | null | undefined): number {
  if (!raw) return 0;
  const n = Number(raw.replace(/,/g, '').trim());
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

/** m.blog.naver.com/{blogId} — 방문자·이웃·게시글 파싱 후 지수 계산 */
export async function scrapeBlogStats(page: Page, blogId: string): Promise<BlogStats | null> {
  const url = `https://m.blog.naver.com/${blogId}`;
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await sleep(1800);

  const html = await page.content().catch(() => '');
  const text = await page.locator('body').innerText().catch(() => '');

  // 셀렉터 시도 (2026-06 m.blog 기준 — 변경 시 HTML regex fallback)
  const selectorHits = await page.evaluate(() => {
    const pick = (sel: string) => {
      const el = document.querySelector(sel);
      return el?.textContent?.replace(/[^\d,]/g, '') ?? '';
    };
    return {
      visitor: pick('.blog_visitor_count') || pick('[class*="visitor"]') || pick('#visitorCounter'),
      buddy: pick('.buddy_count') || pick('[class*="buddy"]') || pick('#buddyCount'),
      posts: pick('.post_count') || pick('[class*="post_count"]') || pick('#postCount'),
    };
  });

  let visitorCount = parseCount(selectorHits.visitor);
  let buddyCount = parseCount(selectorHits.buddy);
  let postCount = parseCount(selectorHits.posts);

  // regex fallback — 실제 페이지 텍스트/HTML에서 숫자 추출
  if (visitorCount === 0) {
    const vm =
      text.match(/전체\s*([\d,]+)/) ??
      html.match(/visitorCount["'\s:]*([\d,]+)/i) ??
      text.match(/방문[^\d]*([\d,]+)/);
    visitorCount = parseCount(vm?.[1]);
  }
  if (buddyCount === 0) {
    const bm =
      text.match(/이웃\s*([\d,]+)/) ??
      html.match(/buddyCount["'\s:]*([\d,]+)/i) ??
      text.match(/서로\s*이웃\s*([\d,]+)/);
    buddyCount = parseCount(bm?.[1]);
  }
  if (postCount === 0) {
    const pm =
      text.match(/게시글\s*([\d,]+)/) ??
      html.match(/postCount["'\s:]*([\d,]+)/i) ??
      text.match(/글\s*([\d,]+)\s*개/);
    postCount = parseCount(pm?.[1]);
  }

  if (visitorCount === 0 && buddyCount === 0 && postCount === 0) return null;

  return { visitorCount, buddyCount, postCount };
}
