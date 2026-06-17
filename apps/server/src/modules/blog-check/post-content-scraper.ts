import type { Frame, Page } from 'playwright';
import { sleep } from '../../lib/utils.js';
import { mobilePostPermalink, mobilePostViewUrl } from './blog-url.js';
import {
  BLOG_CHECK_FRAME_TIMEOUT_MS,
  BLOG_CHECK_PAGE_SETTLE_MS,
} from './constants.js';
import { type PostContentStats } from './content-stats.js';
import { BlogCheckCaptchaError, detectBlogCheckCaptcha } from './scanner.js';

/** SmartEditor ONE · 구형 SE · #viewTypeSelector (legacy) */
const CONTENT_ROOT_SELECTORS = [
  '.se-main-container',
  '#viewTypeSelector',
  'div._postView',
  '#postViewArea',
  '.post_ct',
  '.post-view',
  '#printPost1',
  '.se-viewer',
] as const;

const CONTENT_SELECTOR = CONTENT_ROOT_SELECTORS.join(', ');
const CONTENT_MIN_CHARS = 80;

/** iframe/mainFrame 또는 페이지 DOM 기준 포스트 메타 파싱 */
async function scrapeStatsFromFrame(frame: Frame): Promise<PostContentStats> {
  return frame.evaluate((rootSelectors) => {
    const parseNum = (raw: unknown): number => {
      if (raw == null) return 0;
      const n = Number(String(raw).replace(/,/g, '').trim());
      return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
    };

    const isNaverOwned = (href: string): boolean => {
      try {
        const host = new URL(href).hostname.toLowerCase();
        return (
          host === 'naver.com' ||
          host.endsWith('.naver.com') ||
          host === 'naver.me' ||
          host.endsWith('.naver.me')
        );
      } catch {
        return false;
      }
    };

    const root =
      rootSelectors.map((sel: string) => document.querySelector(sel)).find(Boolean) ??
      document.body;

    const contentText = (root.textContent ?? '').replace(/\s+/g, ' ').trim();
    const charCount = contentText.length;

    const allImgs = [...root.querySelectorAll('img')];
    const gifCount = allImgs.filter((img) => /\.gif($|\?)/i.test(img.getAttribute('src') ?? '')).length;
    const imgCount = allImgs.length - gifCount;

    const videoCount =
      root.querySelectorAll('video').length +
      root.querySelectorAll('iframe[src*="tv.naver"], iframe[src*="naver.tv"]').length;

    const quoteCount = root.querySelectorAll('blockquote').length;

    const mapCount = root.querySelectorAll(
      'iframe[src*="map.naver"], iframe[src*="place.naver"], .se-map, .se-module-map, [class*="map"]',
    ).length;

    let hiddenCount = 0;
    for (const el of root.querySelectorAll('*')) {
      const style = window.getComputedStyle(el);
      const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
      if (style.display === 'none' && text.length > 0) hiddenCount += 1;
    }

    let intLinkCount = 0;
    let extLinkCount = 0;
    const seenLinks = new Set<string>();

    for (const a of root.querySelectorAll('a[href]')) {
      const raw = (a.getAttribute('href') ?? '').trim();
      if (!raw || raw.startsWith('#') || /^javascript:/i.test(raw)) continue;

      let href: string;
      try {
        href = new URL(raw, document.baseURI || location.href).href;
      } catch {
        continue;
      }
      if (!/^https?:\/\//i.test(href)) continue;

      const key = href.split('#')[0];
      if (seenLinks.has(key)) continue;
      seenLinks.add(key);

      if (/blog\.naver\.com/i.test(href) || isNaverOwned(href)) {
        intLinkCount += 1;
      } else {
        extLinkCount += 1;
      }
    }

    let commentCount = 0;
    for (const sel of ['#commentCount', '.comment_count', '.u_cbox_count', '.area_comment .num', '.btn_comment .num']) {
      const t = document.querySelector(sel)?.textContent ?? '';
      const n = parseNum(t.replace(/[^\d]/g, ''));
      if (n > 0) commentCount = Math.max(commentCount, n);
    }
    const commentMatch = document.body.innerText.match(/댓글\s*([\d,]+)/);
    if (commentMatch?.[1]) {
      commentCount = Math.max(commentCount, parseNum(commentMatch[1]));
    }

    let likeCount = 0;
    for (const sel of ['#sympathyCount', '.u_cnt._count', '.sympathy_btn .count', 'em.u_cnt', '.like_count']) {
      const t = document.querySelector(sel)?.textContent ?? '';
      const n = parseNum(t.replace(/[^\d]/g, ''));
      if (n > 0) likeCount = Math.max(likeCount, n);
    }
    const likeMatch = document.body.innerText.match(/공감\s*([\d,]+)/);
    if (likeMatch?.[1]) {
      likeCount = Math.max(likeCount, parseNum(likeMatch[1]));
    }

    return {
      char_count: charCount,
      img_count: imgCount,
      video_count: videoCount,
      quote_count: quoteCount,
      comment_count: commentCount,
      like_count: likeCount,
      gif_count: gifCount,
      map_count: mapCount,
      hidden_count: hiddenCount,
      int_link_count: intLinkCount,
      ext_link_count: extLinkCount,
    };
  }, [...CONTENT_ROOT_SELECTORS]);
}

async function waitForPostContent(frame: Frame): Promise<void> {
  await frame.waitForLoadState('domcontentloaded', { timeout: BLOG_CHECK_FRAME_TIMEOUT_MS }).catch(() => {});
  await frame.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});
  await frame.waitForSelector(CONTENT_SELECTOR, { timeout: BLOG_CHECK_FRAME_TIMEOUT_MS }).catch(() => {});
  await frame
    .waitForFunction(
      ({ selectors, minChars }) => {
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          const len = (el?.textContent ?? '').replace(/\s+/g, ' ').trim().length ?? 0;
          if (len >= minChars) return true;
        }
        return false;
      },
      { selectors: [...CONTENT_ROOT_SELECTORS], minChars: CONTENT_MIN_CHARS },
      { timeout: BLOG_CHECK_FRAME_TIMEOUT_MS },
    )
    .catch(() => {});
  await sleep(BLOG_CHECK_PAGE_SETTLE_MS);
}

async function resolveMainFrame(page: Page): Promise<Frame | null> {
  const frameElement = await page.$('iframe#mainFrame');
  if (!frameElement) return null;

  const frame = await frameElement.contentFrame();
  if (!frame) return null;

  await waitForPostContent(frame);
  return frame;
}

async function scrapeFromFrameOrPage(page: Page, frame?: Frame | null): Promise<PostContentStats> {
  if (frame) return scrapeStatsFromFrame(frame);
  await waitForPostContent(page.mainFrame());
  return scrapeStatsFromFrame(page.mainFrame());
}

async function navigateAndScrape(page: Page, url: string, blogId: string): Promise<PostContentStats> {
  await page.goto(url, { waitUntil: 'domcontentloaded' });

  if (await detectBlogCheckCaptcha(page)) {
    throw new BlogCheckCaptchaError(blogId);
  }

  const frame = (await page.$('iframe#mainFrame')) ? await resolveMainFrame(page) : null;
  return scrapeFromFrameOrPage(page, frame);
}

const EMPTY_STATS: PostContentStats = {
  char_count: 0,
  img_count: 0,
  video_count: 0,
  quote_count: 0,
  comment_count: 0,
  like_count: 0,
  gif_count: 0,
  map_count: 0,
  hidden_count: 0,
  int_link_count: 0,
  ext_link_count: 0,
};

/**
 * m.blog PostView → m.blog permalink → PC permalink mainFrame → PostView mainFrame
 * method: 'mblog-postview' | 'mblog-permalink' | 'desktop-permalink-mainFrame' | 'desktop-postview-mainFrame'
 */
export async function scrapePostContentStats(
  page: Page,
  blogId: string,
  postNo: string,
): Promise<PostContentStats> {
  const strategies = [
    mobilePostViewUrl(blogId, postNo),
    mobilePostPermalink(blogId, postNo),
    `https://blog.naver.com/${encodeURIComponent(blogId)}/${encodeURIComponent(postNo)}`,
    `https://blog.naver.com/PostView.naver?blogId=${encodeURIComponent(blogId)}&logNo=${encodeURIComponent(postNo)}`,
  ];

  let last = EMPTY_STATS;

  for (const url of strategies) {
    const stats = await navigateAndScrape(page, url, blogId);
    last = stats;
    if (stats.char_count >= CONTENT_MIN_CHARS) return stats;
  }

  return last;
}
