import type { Frame, Page } from 'playwright';
import { sleep } from '../../lib/utils.js';
import { type PostContentStats } from './content-stats.js';
import { BlogCheckCaptchaError, detectBlogCheckCaptcha } from './scanner.js';

/** iframe#mainFrame 내부 DOM 기준 포스트 메타 파싱 */
async function scrapeStatsFromFrame(frame: Frame): Promise<PostContentStats> {
  return frame.evaluate(() => {
    const parseNum = (raw: unknown): number => {
      if (raw == null) return 0;
      const n = Number(String(raw).replace(/,/g, '').trim());
      return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
    };

    const root =
      document.querySelector('.se-main-container') ??
      document.querySelector('#postViewArea') ??
      document.querySelector('.post-view') ??
      document.querySelector('#printPost1') ??
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
      const href = (a.getAttribute('href') ?? '').trim();
      if (!href || !/^https?:\/\//i.test(href)) continue;
      const key = href.split('#')[0];
      if (seenLinks.has(key)) continue;
      seenLinks.add(key);

      if (/blog\.naver\.com/i.test(href)) {
        intLinkCount += 1;
      } else if (!/naver\.com/i.test(href)) {
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

async function resolveMainFrame(page: Page, blogId: string, postNo: string): Promise<Frame | null> {
  const frameElement = await page.$('iframe#mainFrame');
  if (!frameElement) return null;

  const frame = await frameElement.contentFrame();
  if (!frame) return null;

  await frame.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => {});
  await frame
    .waitForSelector('.se-main-container, #postViewArea, .post-view, #printPost1', { timeout: 15_000 })
    .catch(() => {});
  await sleep(800);
  return frame;
}

/**
 * blog.naver.com PostView — iframe#mainFrame contentFrame 진입 후 본문 메타 실측
 * method: 'desktop-mainFrame-iframe'
 */
export async function scrapePostContentStats(
  page: Page,
  blogId: string,
  postNo: string,
): Promise<PostContentStats> {
  const desktopUrl = `https://blog.naver.com/${blogId}/${postNo}`;
  await page.goto(desktopUrl, { waitUntil: 'domcontentloaded' });
  await sleep(1500);

  if (await detectBlogCheckCaptcha(page)) {
    throw new BlogCheckCaptchaError(blogId);
  }

  let frame = await resolveMainFrame(page, blogId, postNo);

  if (!frame) {
    const postViewUrl = `https://blog.naver.com/PostView.naver?blogId=${encodeURIComponent(blogId)}&logNo=${encodeURIComponent(postNo)}`;
    await page.goto(postViewUrl, { waitUntil: 'domcontentloaded' });
    await sleep(1200);

    if (await detectBlogCheckCaptcha(page)) {
      throw new BlogCheckCaptchaError(blogId);
    }

    frame = await resolveMainFrame(page, blogId, postNo);
  }

  if (frame) {
    return scrapeStatsFromFrame(frame);
  }

  await page.waitForSelector('.se-main-container, #postViewArea, .post-view', { timeout: 15_000 }).catch(() => {});
  await sleep(600);
  return scrapeStatsFromFrame(page.mainFrame());
}
