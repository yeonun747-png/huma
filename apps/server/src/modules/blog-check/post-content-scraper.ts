import type { Frame, Page } from 'playwright';
import { sleep } from '../../lib/utils.js';
import {
  BLOG_CHECK_FRAME_TIMEOUT_MS,
  BLOG_CHECK_PAGE_SETTLE_MS,
} from './constants.js';
import { type PostContentStats } from './content-stats.js';
import { BlogCheckCaptchaError, detectBlogCheckCaptcha } from './scanner.js';

const CONTENT_SELECTOR =
  '.se-main-container, #postViewArea, .post-view, #printPost1, .post_ct, .se-viewer';

/** iframe#mainFrame 내부 DOM 기준 포스트 메타 파싱 */
async function scrapeStatsFromFrame(frame: Frame): Promise<PostContentStats> {
  return frame.evaluate(() => {
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
      document.querySelector('.se-main-container') ??
      document.querySelector('#postViewArea') ??
      document.querySelector('.post-view') ??
      document.querySelector('#printPost1') ??
      document.querySelector('.post_ct') ??
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
  });
}

async function waitForPostContent(frame: Frame): Promise<void> {
  await frame.waitForLoadState('domcontentloaded', { timeout: BLOG_CHECK_FRAME_TIMEOUT_MS }).catch(() => {});
  await frame.waitForSelector(CONTENT_SELECTOR, { timeout: BLOG_CHECK_FRAME_TIMEOUT_MS }).catch(() => {});
  await frame
    .waitForFunction(
      () => {
        const root =
          document.querySelector('.se-main-container') ??
          document.querySelector('#postViewArea') ??
          document.querySelector('.post-view') ??
          document.querySelector('.post_ct');
        return (root?.textContent?.replace(/\s+/g, ' ').trim().length ?? 0) > 80;
      },
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

async function tryMobilePostView(
  page: Page,
  blogId: string,
  postNo: string,
): Promise<PostContentStats | null> {
  const mobileUrl = `https://m.blog.naver.com/${encodeURIComponent(blogId)}/${encodeURIComponent(postNo)}`;
  await page.goto(mobileUrl, { waitUntil: 'domcontentloaded' });

  if (await detectBlogCheckCaptcha(page)) {
    throw new BlogCheckCaptchaError(blogId);
  }

  const stats = await scrapeFromFrameOrPage(page);
  return stats.char_count > 0 ? stats : null;
}

async function tryDesktopPostView(
  page: Page,
  blogId: string,
  postNo: string,
): Promise<PostContentStats> {
  const postViewUrl = `https://blog.naver.com/PostView.naver?blogId=${encodeURIComponent(blogId)}&logNo=${encodeURIComponent(postNo)}`;
  await page.goto(postViewUrl, { waitUntil: 'domcontentloaded' });

  if (await detectBlogCheckCaptcha(page)) {
    throw new BlogCheckCaptchaError(blogId);
  }

  const frame = await resolveMainFrame(page);
  return scrapeFromFrameOrPage(page, frame);
}

/**
 * m.blog 직접 → PostView iframe#mainFrame 순으로 본문 메타 파싱
 * method: 'mblog-direct' | 'postview-direct-mainFrame'
 */
export async function scrapePostContentStats(
  page: Page,
  blogId: string,
  postNo: string,
): Promise<PostContentStats> {
  const mobile = await tryMobilePostView(page, blogId, postNo);
  if (mobile) return mobile;
  return tryDesktopPostView(page, blogId, postNo);
}
