import type { Page } from 'playwright';
import { navigateBlogCheck } from './scanner.js';

export interface BlogStats {
  visitorCount: number;
  buddyCount: number;
  postCount: number;
}

export interface ScrapeBlogStatsResult {
  stats: BlogStats;
  /** 파싱에 성공한 방법 (코드 주석용 메타) */
  method: string;
}

/** HUMA 자체 지수 — 방문 MIN(v/500,1)×5 + 이웃 MIN(b/300,1)×3 + 게시글 MIN(p/100,1)×2, 최대 10.0 */
export function computeBlogIndexScore(stats: BlogStats): number {
  const visitorScore = Math.min(stats.visitorCount / 500, 1) * 5;
  const buddyScore = Math.min(stats.buddyCount / 300, 1) * 3;
  const postScore = Math.min(stats.postCount / 100, 1) * 2;
  const raw = visitorScore + buddyScore + postScore;
  return Math.min(10, Math.round(raw * 10) / 10);
}

function parseCount(raw: string): number {
  const n = Number(raw.replace(/,/g, '').trim());
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

/** 1순위: "방문자"|"이웃"|"게시글" 키워드 주변 숫자 */
function extractKeywordCount(text: string, keywords: string[]): number | null {
  for (const kw of keywords) {
    const re = new RegExp(`${kw}[^\\d]{0,24}([\\d,]+)`, 'i');
    const m = text.match(re);
    if (m?.[1]) {
      const n = parseCount(m[1]);
      if (n > 0) return n;
    }
  }
  return null;
}

/** 2순위: 통계 영역 줄 단위 스캔 (키워드+숫자 동일 줄) */
function extractFromStatsRegion(text: string): BlogStats | null {
  const lines = text.split(/\n/).map((l) => l.trim()).filter(Boolean);
  let visitorCount: number | null = null;
  let buddyCount: number | null = null;
  let postCount: number | null = null;

  for (const line of lines) {
    const nums = [...line.matchAll(/[\d,]+/g)]
      .map((m) => parseCount(m[0]))
      .filter((n) => n > 0);
    if (!nums.length) continue;

    if (/방문|visitor|today|total/i.test(line) && visitorCount === null) {
      visitorCount = Math.max(...nums);
    }
    if (/이웃|buddy|neighbor|친구/i.test(line) && buddyCount === null) {
      buddyCount = nums[0];
    }
    if (/게시|post|글\s*\d|작성/i.test(line) && postCount === null) {
      postCount = nums[0];
    }
  }

  if (visitorCount === null && buddyCount === null && postCount === null) return null;
  return {
    visitorCount: visitorCount ?? 0,
    buddyCount: buddyCount ?? 0,
    postCount: postCount ?? 0,
  };
}

/**
 * m.blog.naver.com/{blogId}
 * 셀렉터 하드코딩 없음 — 키워드 텍스트 → 통계 영역 순.
 * 성공 시 method: 'keyword-text' | 'stats-region'
 */
export async function scrapeBlogStats(page: Page, blogId: string): Promise<ScrapeBlogStatsResult | null> {
  const url = `https://m.blog.naver.com/${blogId}`;
  await navigateBlogCheck(page, url);

  const text = await page.locator('body').innerText().catch(() => '');
  if (!text.trim()) return null;

  const visitorKw = extractKeywordCount(text, ['전체', '방문자', '방문', 'visitor']);
  const buddyKw = extractKeywordCount(text, ['이웃', 'buddy', '서로이웃', '서로 이웃']);
  const postKw = extractKeywordCount(text, ['게시글', '게시', '글']);

  if (visitorKw != null || buddyKw != null || postKw != null) {
    const stats: BlogStats = {
      visitorCount: visitorKw ?? 0,
      buddyCount: buddyKw ?? 0,
      postCount: postKw ?? 0,
    };
    if (stats.visitorCount + stats.buddyCount + stats.postCount > 0) {
      return { stats, method: 'keyword-text' };
    }
  }

  const region = extractFromStatsRegion(text);
  if (region && region.visitorCount + region.buddyCount + region.postCount > 0) {
    return { stats: region, method: 'stats-region' };
  }

  return null;
}
