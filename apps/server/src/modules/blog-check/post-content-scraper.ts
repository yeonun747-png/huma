import type { Frame, Page, Response } from 'playwright';
import { sleep } from '../../lib/utils.js';
import { mobilePostViewUrl } from './blog-url.js';
import {
  BLOG_CHECK_ENGAGEMENT_WAIT_MS,
  BLOG_CHECK_FRAME_TIMEOUT_MS,
  BLOG_CHECK_LIKE_API_TIMEOUT_MS,
  BLOG_CHECK_PAGE_SETTLE_MS,
} from './constants.js';
import { type PostContentStats, mergePostContentStats } from './content-stats.js';
import { BlogCheckCaptchaError, navigateBlogCheck, resolveBlogCheckCaptcha, type BlogCheckCaptchaContext } from './scanner.js';

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
    let bestLen = 0;
    for (const el of candidates) {
      const len = countBodyChars(el);
      if (len > bestLen) {
        bestLen = len;
        best = el;
      } else if (len === bestLen && len > 0 && el.classList.contains('se-main-container')) {
        best = el;
      }
    }

    if (best) return best;
    if (postView && countBodyChars(postView) >= 80) return postView;
    const legacy = document.querySelector('#viewTypeSelector');
    if (legacy && countBodyChars(legacy) >= 80) return legacy;
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

  /** SE 이미지 모듈 기준 집계 (lazy img·background-image 대응) */
  const countImagesInScope = (scope: Element): { imgCount: number; gifCount: number } => {
    const modules = new Set<Element>();
    const moduleSelectors = [
      '.se-section:not(.se-section-documentTitle) .se-component.se-image',
      '.se-section:not(.se-section-documentTitle) .se-module-image',
      '.se-component.se-image',
      '.se-component-image',
      '.se-module.se-image',
      '[data-module="image"]',
      '.se-image-resource',
      '.se_component.se_image',
      '#viewTypeSelector .se_component.se_image',
    ];
    for (const sel of moduleSelectors) {
      scope.querySelectorAll(sel).forEach((el) => {
        if (el.closest('.se-blind')) return;
        if (el.closest('.se-section-documentTitle')) return;
        const comp = el.closest('.se-component.se-image, .se_component.se_image') ?? el;
        modules.add(comp);
      });
    }

    let gifCount = 0;
    let imgCount = 0;

    if (modules.size > 0) {
      for (const mod of modules) {
        const img = mod.querySelector('img');
        const src =
          img?.getAttribute('src') ??
          img?.getAttribute('data-lazy-src') ??
          img?.getAttribute('data-src') ??
          mod.getAttribute('data-lazy-src') ??
          '';
        if (/\.gif($|\?)/i.test(src)) gifCount += 1;
        else imgCount += 1;
      }
      return { imgCount, gifCount };
    }

    const contentImgs = [
      ...scope.querySelectorAll(
        '.se-module-image img, .se-image img, img.se_mediaImage, .se_component img, .se-module img, #viewTypeSelector img',
      ),
    ];
    const allImgs =
      contentImgs.length > 0
        ? contentImgs
        : [...scope.querySelectorAll('img')].filter((img) => {
            const cls = img.className ?? '';
            if (/profile|logo|btn|icon|spinner|avatar/i.test(cls)) return false;
            const w = img.naturalWidth || Number(img.getAttribute('width')) || 0;
            const h = img.naturalHeight || Number(img.getAttribute('height')) || 0;
            if (w > 0 && h > 0 && w < 40 && h < 40) return false;
            return true;
          });
    gifCount = allImgs.filter((img) => /\.gif($|\?)/i.test(img.getAttribute('src') ?? '')).length;
    imgCount = allImgs.length - gifCount;
    return { imgCount, gifCount };
  };

  const pickImageScope = (): Element => {
    const pv = document.querySelector(`#post-view${logNo}`);
    if (pv) return pv;

    let best: Element | null = null;
    let bestScore = 0;
    for (const el of document.querySelectorAll('.se-main-container, .se_component_wrap, #viewTypeSelector')) {
      if (el.closest('.se-blind')) continue;
      const { imgCount: mods } = countImagesInScope(el);
      const chars = countBodyChars(el);
      const score = mods * 1000 + chars;
      if (score > bestScore) {
        bestScore = score;
        best = el;
      }
    }
    return best ?? root;
  };

  const { imgCount, gifCount } = countImagesInScope(pickImageScope());

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

  /** 댓글·공감 — 본문 텍스트(「공감 200%」 등)와 구분, 포스트 푸터 위젯만 */
  const engagementScopes: Element[] = [];
  const postView = document.querySelector(`#post-view${logNo}`);
  if (postView) engagementScopes.push(postView);
  document
    .querySelectorAll('.wrap_postcomment, .post-btn, #spiButton, .post_recommend')
    .forEach((el) => engagementScopes.push(el));

  const pickFirstCount = (selectors: string[]): number => {
    for (const scope of engagementScopes.length > 0 ? engagementScopes : [document.body]) {
      for (const sel of selectors) {
        const t = scope.querySelector(sel)?.textContent ?? '';
        const n = parseNum(t.replace(/[^\d]/g, ''));
        if (n > 0) return n;
      }
    }
    return 0;
  };

  const parseLikeCount = (): number => {
    const scopes = engagementScopes.length > 0 ? engagementScopes : [document.body];

    for (const scope of scopes) {
      const likeEl = scope.querySelector(
        '.u_likeit_list.like .u_likeit_list_count._count, .u_likeit_list_button[data-type="like"] .u_likeit_list_count._count',
      );
      if (likeEl?.textContent?.trim()) {
        const n = parseNum(likeEl.textContent);
        if (Number.isFinite(n)) return n;
      }

      const faceCount = scope.querySelector(
        '.u_likeit_button._face .u_likeit_text._count.num, .u_likeit_list_module._reactionModule .u_likeit_text._count.num',
      );
      if (faceCount?.textContent?.trim()) {
        const n = parseNum(faceCount.textContent);
        if (Number.isFinite(n)) return n;
      }

      const symBtn = scope.querySelector(`#Sympathy${logNo}`);
      if (symBtn?.textContent) {
        const m = symBtn.textContent.match(/공감\s*(\d+)/);
        if (m?.[1]) return parseNum(m[1]);
      }
    }

    return pickFirstCount([
      '.u_likeit_list_module._postSympathyView .u_cnt._count',
      '.u_likeit_list_module._postSympathyView em.u_cnt',
      '.u_likeit_list_module._postSympathyView .u_cnt',
      '.u_likeit_list_module._reactionModule .u_likeit_list.like .u_likeit_list_count._count',
      '.u_likeit_list_btn .u_cnt._count',
      '.u_likeit_list_btn em.u_cnt',
      '#sympathyCount',
      '.sympathy_btn .count',
    ]);
  };

  const commentCount = pickFirstCount([
    '#commentCount',
    '.comment_count',
    '.u_cbox_count',
    '.area_comment .num',
    '.btn_comment .num',
  ]);

  const likeCount = parseLikeCount();

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
  await frame.waitForSelector(CONTENT_SELECTOR, { timeout: 3_000 }).catch(() => {});
  await sleep(BLOG_CHECK_PAGE_SETTLE_MS);
}

function parseJsonpPayload(text: string): unknown {
  const trimmed = text.trim();
  const start = trimmed.indexOf('(');
  const end = trimmed.lastIndexOf(')');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(trimmed.slice(start + 1, end));
  } catch {
    return null;
  }
}

function parseLikeFromLikeApiPayload(json: unknown): number {
  if (!json || typeof json !== 'object') return 0;
  const root = json as Record<string, unknown>;

  for (const item of (root.contents as unknown[]) ?? []) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;

    for (const reaction of (row.reactions as unknown[]) ?? []) {
      if (!reaction || typeof reaction !== 'object') continue;
      const rx = reaction as Record<string, unknown>;
      if (rx.reactionType === 'like') {
        return Math.max(0, Number(rx.count ?? rx.reactionCount ?? 0));
      }
    }

    const map = row.reactionMap as Record<string, unknown> | null | undefined;
    if (map?.like != null) {
      if (typeof map.like === 'number') return Math.max(0, map.like);
      if (typeof map.like === 'object') {
        const like = map.like as Record<string, unknown>;
        return Math.max(0, Number(like.count ?? like.reactionCount ?? 0));
      }
    }
  }

  return 0;
}

/** page.evaluate — 공감·댓글 (포스트 chrome만) */
const READ_ENGAGEMENT_FN = (logNo: string) => {
  const parseNum = (raw: unknown): number => {
    if (raw == null) return 0;
    const n = Number(String(raw).replace(/,/g, '').trim());
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
  };

  const scopes: Element[] = [];
  const postView = document.querySelector(`#post-view${logNo}`);
  if (postView) scopes.push(postView);
  document
    .querySelectorAll('.wrap_postcomment, .post-btn, #spiButton, .post_recommend, .floating_bottom')
    .forEach((el) => scopes.push(el));

  const pickFirst = (selectors: string[]): number => {
    for (const scope of scopes.length > 0 ? scopes : [document.body]) {
      for (const sel of selectors) {
        const t = scope.querySelector(sel)?.textContent ?? '';
        const n = parseNum(t.replace(/[^\d]/g, ''));
        if (n > 0) return n;
      }
    }
    return 0;
  };

  let likeCount = 0;
  for (const scope of scopes.length > 0 ? scopes : [document.body]) {
    const likeEl = scope.querySelector(
      '.u_likeit_list.like .u_likeit_list_count._count, .u_likeit_list_button[data-type="like"] .u_likeit_list_count._count',
    );
    if (likeEl?.textContent?.trim()) {
      likeCount = parseNum(likeEl.textContent);
      break;
    }
    const faceCount = scope.querySelector('.u_likeit_button._face .u_likeit_text._count.num');
    if (faceCount?.textContent?.trim()) {
      likeCount = parseNum(faceCount.textContent);
      break;
    }
    const symBtn = scope.querySelector(`#Sympathy${logNo}`);
    const symMatch = symBtn?.textContent?.match(/공감\s*(\d+)/);
    if (symMatch?.[1]) {
      likeCount = parseNum(symMatch[1]);
      break;
    }
  }

  if (likeCount === 0) {
    likeCount = pickFirst([
      '.u_likeit_list_module._reactionModule .u_likeit_list.like .u_likeit_list_count._count',
      '.u_likeit_list_module._postSympathyView .u_cnt._count',
      '.u_likeit_list_btn .u_cnt._count',
    ]);
  }

  return {
    comment_count: pickFirst(['#commentCount', '.comment_count', '.u_cbox_count', '.area_comment .num']),
    like_count: likeCount,
  };
};

async function fetchSympathyViaLikeApi(page: Page, blogId: string, postNo: string): Promise<number> {
  const cid = `${blogId}_${postNo}`;
  const isMobile = page.url().includes('m.blog.naver.com');
  const params = new URLSearchParams({
    suppress_response_codes: 'true',
    q: `BLOG[${cid}]`,
    isDuplication: 'false',
    cssIds: isMobile ? 'BASIC_MOBILE,MULTI_MOBILE' : 'BASIC_PC,MULTI_PC',
  });

  try {
    const res = await page.request.get(`https://route-like.naver.com/v1/search/contents?${params.toString()}`, {
      headers: {
        Referer: page.url(),
        Accept: 'application/json, text/javascript, */*',
      },
    });
    const text = await res.text();
    return parseLikeFromLikeApiPayload(parseJsonpPayload(text));
  } catch {
    return 0;
  }
}

async function fetchEngagementFast(
  page: Page,
  blogId: string,
  postNo: string,
  likeNetwork: Promise<Response | null>,
): Promise<Pick<PostContentStats, 'comment_count' | 'like_count'>> {
  const [likeResp, likeApi] = await Promise.all([
    likeNetwork
      .then(async (resp) => {
        if (!resp) return 0;
        try {
          return parseLikeFromLikeApiPayload(parseJsonpPayload(await resp.text()));
        } catch {
          return 0;
        }
      })
      .catch(() => 0),
    fetchSympathyViaLikeApi(page, blogId, postNo),
  ]);

  let likeCount = Math.max(likeApi, likeResp);

  if (likeCount === 0) {
    await page
      .mainFrame()
      .waitForFunction(
        () => {
          const mod = document.querySelector(
            '.u_likeit_list_module._reactionModule, .u_likeit_list_module._postSympathyView',
          );
          return (
            mod?.getAttribute('data-loaded') === '1' ||
            !!mod?.querySelector('.u_likeit_list_count._count, .u_likeit_text._count.num')
          );
        },
        { timeout: BLOG_CHECK_ENGAGEMENT_WAIT_MS },
      )
      .catch(() => {});
  }

  const dom = await page.mainFrame().evaluate(READ_ENGAGEMENT_FN, postNo);
  return {
    like_count: Math.max(likeCount, dom.like_count),
    comment_count: dom.comment_count,
  };
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

async function navigateAndScrape(
  page: Page,
  url: string,
  blogId: string,
  postNo: string,
  captchaCtx: BlogCheckCaptchaContext = {},
): Promise<PostContentStats> {
  const likeNetwork = page
    .waitForResponse(
      (resp) =>
        resp.url().includes('route-like.naver.com/v1/search/contents') &&
        resp.url().includes(blogId) &&
        resp.status() === 200,
      { timeout: BLOG_CHECK_LIKE_API_TIMEOUT_MS },
    )
    .catch(() => null);

  await navigateBlogCheck(page, url);

  if (!(await resolveBlogCheckCaptcha(page, { ...captchaCtx, blogId }))) {
    throw new BlogCheckCaptchaError(blogId);
  }

  let stats = EMPTY_STATS;

  if (await page.$('iframe#mainFrame')) {
    const frame = await resolveMainFrame(page);
    if (frame) stats = await scrapeStatsFromFrame(frame, postNo);
  } else {
    await waitForPostContent(page.mainFrame());
    stats = await scrapeStatsFromFrame(page.mainFrame(), postNo);
  }

  const engagement = await fetchEngagementFast(page, blogId, postNo, likeNetwork);
  return mergePostContentStats(stats, engagement);
}

/** PostView·m.blog 본문 페이지 — 노출 검색용 실제 제목 */
export async function scrapePostTitle(page: Page): Promise<string | null> {
  return page
    .evaluate(() => {
      const og = document.querySelector('meta[property="og:title"]')?.getAttribute('content')?.trim();
      if (og) return og.replace(/\s*:\s*네이버\s*블로그\s*$/i, '').trim() || null;
      const se =
        document.querySelector('.se_title .pcol1, .se-title-text, .tit_h3, #title_1')?.textContent?.trim() ??
        null;
      if (se) return se;
      const docTitle = document.title?.replace(/\s*:\s*네이버\s*블로그\s*$/i, '').trim();
      return docTitle || null;
    })
    .catch(() => null);
}

export async function scrapePostContentStats(
  page: Page,
  blogId: string,
  postNo: string,
  captchaCtx: BlogCheckCaptchaContext = {},
): Promise<PostContentStats> {
  const mobileUrl = mobilePostViewUrl(blogId, postNo);
  const desktopUrl = `https://blog.naver.com/PostView.naver?blogId=${encodeURIComponent(blogId)}&logNo=${encodeURIComponent(postNo)}`;
  // blog-check 브라우저는 모바일 UA — m.blog 우선(데스크톱 PostView+iframe은 Xvfb에서 hang·타임아웃 빈발)
  let stats = await navigateAndScrape(page, mobileUrl, blogId, postNo, captchaCtx);

  if (stats.char_count < CONTENT_MIN_CHARS) {
    stats = mergePostContentStats(
      stats,
      await navigateAndScrape(page, desktopUrl, blogId, postNo, captchaCtx),
    );
  }

  return stats;
}
