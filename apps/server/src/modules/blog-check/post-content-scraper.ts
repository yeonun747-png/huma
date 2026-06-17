import type { Frame, Page } from 'playwright';
import { sleep } from '../../lib/utils.js';
import { mobilePostPermalink, mobilePostViewUrl } from './blog-url.js';
import {
  BLOG_CHECK_FRAME_TIMEOUT_MS,
  BLOG_CHECK_PAGE_SETTLE_MS,
} from './constants.js';
import { type PostContentStats } from './content-stats.js';
import { BlogCheckCaptchaError, detectBlogCheckCaptcha } from './scanner.js';

/** SmartEditor 본문 후보 — post-view 내부만 사용 (페이지 chrome 제외) */
const CONTENT_ROOT_SELECTORS = [
  '.se-main-container',
  '#viewTypeSelector',
  'div._postView',
  '#postViewArea',
  '.se_component_wrap',
  '.post_ct',
  '.post-view',
  '#printPost1',
  '.se-viewer',
] as const;

const CONTENT_SELECTOR = CONTENT_ROOT_SELECTORS.join(', ');
const CONTENT_MIN_CHARS = 80;

/** page.evaluate 내부 — blai 스타일 본문 루트·메타 집계 */
const SCRAPE_STATS_FN = ({
  rootSelectors,
  postNo: logNo,
}: {
  rootSelectors: string[];
  postNo: string;
}) => {
  const parseNum = (raw: unknown): number => {
    if (raw == null) return 0;
    const n = Number(String(raw).replace(/,/g, '').trim());
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
  };

  const textLen = (el: Element | null | undefined): number =>
    countBodyChars(el ?? document.body);

  /** SmartEditor 본문 글자수 — 모듈당 leaf .se-text 1개만(중첩 중복 방지) */
  function countBodyChars(scope: Element | null | undefined): number {
    if (!scope) return 0;
    const parts: string[] = [];

    scope.querySelectorAll('.se-text').forEach((el) => {
      if (el.closest('.se-blind')) return;
      if (el.querySelector('.se-text')) return;
      const t = (el.textContent ?? '').replace(/\u00a0/g, ' ').trim();
      if (t) parts.push(t);
    });

    if (parts.length === 0) {
      scope.querySelectorAll('.se-module-text, .se_module_text').forEach((mod) => {
        if (mod.closest('.se-blind')) return;
        const leaf = mod.querySelector('.se-text');
        const t = (leaf?.textContent ?? mod.textContent ?? '').replace(/\u00a0/g, ' ').trim();
        if (t.length >= 10) parts.push(t);
      });
    }

    if (parts.length === 0) {
      scope.querySelectorAll('#viewTypeSelector .se_component').forEach((comp) => {
        if (comp.closest('.se-blind')) return;
        const t = (comp.textContent ?? '').replace(/\u00a0/g, ' ').trim();
        if (t.length >= 20) parts.push(t);
      });
    }

    if (parts.length > 0) return parts.join('\n').length;

    return (scope.innerText ?? '').replace(/\u00a0/g, ' ').trim().length;
  }

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

  const pickContentRoot = (): Element => {
    const postView = document.querySelector(`#post-view${logNo}`);
    const candidates: Element[] = [];

    const push = (el: Element | null) => {
      if (!el || el === document.body) return;
      if (textLen(el) < 80) return;
      candidates.push(el);
    };

    if (postView) {
      postView.querySelectorAll('.se-main-container').forEach((el) => push(el));
      push(postView.querySelector('#viewTypeSelector'));
      push(postView.querySelector('.se_component_wrap'));
    }

    for (const sel of rootSelectors) {
      for (const el of document.querySelectorAll(sel)) {
        if (postView && !postView.contains(el)) continue;
        push(el);
      }
    }

    let best: Element | null = null;
    let bestScore = -1;
    for (const el of candidates) {
      const len = textLen(el);
      let score = len;
      if (el.classList.contains('se-main-container')) score += 1_000_000;
      else if (el.id === 'viewTypeSelector') score += 500_000;
      else if (el.classList.contains('se_component_wrap')) score += 250_000;
      else if (postView && el === postView) score += 10_000;
      if (score > bestScore) {
        bestScore = score;
        best = el;
      }
    }

    if (best) return best;
    if (postView && textLen(postView) >= 80) return postView;
    return document.body;
  };

  const root = pickContentRoot();

  let charCount = countBodyChars(root);
  if (charCount < 80) {
    const ogDesc =
      document.querySelector('meta[property="og:description"]')?.getAttribute('content') ??
      document.querySelector('meta[name="description"]')?.getAttribute('content') ??
      '';
    const ogText = ogDesc.replace(/\s+/g, ' ').trim();
    if (ogText.length > charCount) charCount = ogText.length;
  }

  const contentImgs = [
    ...root.querySelectorAll(
      '.se-module-image img, .se-image img, img.se_mediaImage, .se_component img, .se-module img',
    ),
  ];
  const allImgs =
    contentImgs.length > 0
      ? contentImgs
      : [...root.querySelectorAll('img')].filter((img) => {
          const cls = img.className ?? '';
          if (/profile|logo|btn|icon|spinner|avatar/i.test(cls)) return false;
          const w = img.naturalWidth || Number(img.getAttribute('width')) || 0;
          const h = img.naturalHeight || Number(img.getAttribute('height')) || 0;
          if (w > 0 && h > 0 && w < 40 && h < 40) return false;
          return true;
        });
  const gifCount = allImgs.filter((img) => /\.gif($|\?)/i.test(img.getAttribute('src') ?? '')).length;
  const imgCount = allImgs.length - gifCount;

  const videoCount =
    root.querySelectorAll('video, .se-module-video, .se-video').length +
    root.querySelectorAll('iframe[src*="tv.naver"], iframe[src*="naver.tv"]').length;

  const quoteCount =
    root.querySelectorAll('blockquote, .se-module-quotation, .se-quotation').length;

  const mapCount = root.querySelectorAll(
    'iframe[src*="map.naver"], iframe[src*="place.naver"], .se-map, .se-module-map',
  ).length;

  /** SE 접기/숨김 문단 — 페이지 chrome display:none 과 구분 */
  const hiddenCount =
    root.querySelectorAll('.se-blind, .se-hide, .se-hidden, .__se_hidden').length +
    root.querySelectorAll('.se-module-text .se-text[style*="display:none"], .se-module-text .se-text[style*="display: none"]').length;

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
};

async function waitForPostContent(frame: Frame): Promise<void> {
  await frame.waitForLoadState('domcontentloaded', { timeout: BLOG_CHECK_FRAME_TIMEOUT_MS }).catch(() => {});
  await frame.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});
  await frame.waitForSelector(CONTENT_SELECTOR, { timeout: BLOG_CHECK_FRAME_TIMEOUT_MS }).catch(() => {});
  await frame
    .waitForFunction(
      ({ rootSelectors, minChars }: { rootSelectors: string[]; minChars: number }) => {
        const postNoEl = document.querySelector('[id^="post-view"]');
        const scopes = postNoEl ? [postNoEl, document.body] : [document.body];
        for (const scope of scopes) {
          for (const sel of rootSelectors) {
            for (const el of scope.querySelectorAll(sel)) {
              const len = (el.textContent ?? '').replace(/\s+/g, ' ').trim().length;
              if (len >= minChars) return true;
            }
          }
        }
        return false;
      },
      { rootSelectors: [...CONTENT_ROOT_SELECTORS], minChars: CONTENT_MIN_CHARS },
      { timeout: BLOG_CHECK_FRAME_TIMEOUT_MS },
    )
    .catch(() => {});
  await sleep(BLOG_CHECK_PAGE_SETTLE_MS);
}

async function scrapeStatsFromFrame(frame: Frame, postNo: string): Promise<PostContentStats> {
  return frame.evaluate(SCRAPE_STATS_FN, {
    rootSelectors: [...CONTENT_ROOT_SELECTORS],
    postNo,
  });
}

async function resolveMainFrame(page: Page): Promise<Frame | null> {
  const frameElement = await page.$('iframe#mainFrame');
  if (!frameElement) return null;

  const frame = await frameElement.contentFrame();
  if (!frame) return null;

  await waitForPostContent(frame);
  return frame;
}

async function scrapeFromPage(page: Page, postNo: string): Promise<PostContentStats> {
  await waitForPostContent(page.mainFrame());
  return scrapeStatsFromFrame(page.mainFrame(), postNo);
}

async function navigateAndScrape(
  page: Page,
  url: string,
  blogId: string,
  postNo: string,
): Promise<PostContentStats> {
  await page.goto(url, { waitUntil: 'domcontentloaded' });

  if (await detectBlogCheckCaptcha(page)) {
    throw new BlogCheckCaptchaError(blogId);
  }

  let stats = await scrapeFromPage(page, postNo);
  if (stats.char_count >= CONTENT_MIN_CHARS) return stats;

  if (await page.$('iframe#mainFrame')) {
    const frame = await resolveMainFrame(page);
    if (frame) {
      const frameStats = await scrapeStatsFromFrame(frame, postNo);
      if (frameStats.char_count >= stats.char_count) stats = frameStats;
    }
  }

  return stats;
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

  let best = EMPTY_STATS;

  for (const url of strategies) {
    const stats = await navigateAndScrape(page, url, blogId, postNo);
    if (stats.char_count > best.char_count) best = stats;
    if (stats.char_count >= CONTENT_MIN_CHARS) return stats;
  }

  return best;
}
