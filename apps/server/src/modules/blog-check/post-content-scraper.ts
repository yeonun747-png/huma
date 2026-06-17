import type { Frame, Page } from 'playwright';
import { sleep } from '../../lib/utils.js';
import { type PostContentStats, emptyPostContentStats, mergePostContentStats } from './content-stats.js';
import { BlogCheckCaptchaError, detectBlogCheckCaptcha } from './scanner.js';

type ScrapeContext = Page | Frame;

async function evaluatePostStats(ctx: ScrapeContext, blogId: string, postNo: string): Promise<PostContentStats> {
  return ctx.evaluate(
    async ({ blogId, postNo }) => {
      const parseNum = (raw: unknown): number | null => {
        if (raw == null) return null;
        const n = Number(String(raw).replace(/,/g, '').trim());
        return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
      };

      const scriptNum = (patterns: RegExp[]): number | null => {
        const html = document.documentElement.innerHTML;
        for (const re of patterns) {
          const m = html.match(re);
          if (m?.[1] != null) {
            const n = parseNum(m[1]);
            if (n != null) return n;
          }
        }
        return null;
      };

      let apiComment: number | null = null;
      let apiLike: number | null = null;
      let apiHtml: string | null = null;

      try {
        const res = await fetch(
          `https://m.blog.naver.com/api/blogs/${blogId}/posts/${postNo}`,
          { credentials: 'include', headers: { Accept: 'application/json' } },
        );
        if (res.ok) {
          const json = (await res.json()) as {
            isSuccess?: boolean;
            result?: {
              sympathyCnt?: number;
              sympathyCount?: number;
              commentCnt?: number;
              commentCount?: number;
              contents?: string;
              postText?: string;
            };
          };
          if (json?.isSuccess && json.result) {
            const r = json.result;
            apiComment = parseNum(r.commentCnt ?? r.commentCount);
            apiLike = parseNum(r.sympathyCnt ?? r.sympathyCount);
            apiHtml = r.contents ?? r.postText ?? null;
          }
        }
      } catch {
        /* API 실패 — DOM 폴백 */
      }

      const root =
        document.querySelector('.se-main-container') ??
        document.querySelector('#viewTypeSelector') ??
        document.querySelector('.post_ct') ??
        document.querySelector('#postViewArea') ??
        document.querySelector('.post-view') ??
        document.querySelector('#printPost1');

      const contentEl = root ?? document.body;
      const contentHtml = apiHtml ?? contentEl.innerHTML;
      const contentText = (contentEl.textContent ?? '').replace(/\s+/g, ' ').trim();

      const imgUrls = new Set<string>();
      const collectImg = (src: string | null | undefined) => {
        const s = (src ?? '').trim();
        if (!s || s.startsWith('data:')) return;
        if (/blank\.gif|spacer|icon|emoji|profile|blogpfthumb|static\.blog/i.test(s)) return;
        imgUrls.add(s.split('#')[0].split('?')[0]);
      };

      contentEl.querySelectorAll('img').forEach((img) => {
        collectImg(img.getAttribute('src'));
        collectImg(img.getAttribute('data-lazy-src'));
        collectImg(img.getAttribute('data-src'));
      });

      for (const m of contentHtml.matchAll(/(?:src|data-lazy-src|data-src)=["']([^"']+)["']/gi)) {
        collectImg(m[1]);
      }

      let gifCount = 0;
      let imgCount = 0;
      for (const u of imgUrls) {
        if (/\.gif($|\?)/i.test(u)) gifCount += 1;
        else imgCount += 1;
      }

      const videoCount = Math.max(
        contentEl.querySelectorAll('video, .se-video, .se-module-video').length,
        contentEl.querySelectorAll(
          'iframe[src*="youtube"], iframe[src*="naver.tv"], iframe[src*="tv.naver"]',
        ).length,
        /youtube\.com|youtu\.be|naver\.tv|tv\.naver\.com|\.mp4|\.webm|\.mov/i.test(contentHtml) ? 1 : 0,
      );

      const quoteCount = Math.max(
        contentEl.querySelectorAll('.se-quote, .se-module-quote, blockquote, .se-quotation').length,
        (contentText.match(/^>\s?.+/gm) ?? []).length,
      );

      const mapCount = Math.max(
        contentEl.querySelectorAll(
          'iframe[src*="map.naver"], iframe[src*="place.naver"], .se-map, .se-module-map',
        ).length,
        (contentHtml.match(/map\.naver\.com|place\.naver\.com|naver\.me\/map|\[지도\]/gi) ?? []).length,
      );

      const hiddenCount = Math.max(
        contentEl.querySelectorAll('.se-spoiler, .se-module-spoiler, [class*="spoiler"]').length,
        (contentText.match(/\[히든\]|<!--hidden-->|\(히든\)|스포일러|spoiler/gi) ?? []).length,
      );

      const links = new Set<string>();
      const addLink = (raw: string) => {
        const href = raw.trim().replace(/&amp;/g, '&');
        if (!href || !/^https?:\/\//i.test(href)) return;
        links.add(href.split('#')[0]);
      };

      contentEl.querySelectorAll('a[href]').forEach((a) => addLink(a.getAttribute('href') ?? ''));
      for (const m of contentHtml.matchAll(/https?:\/\/[^\s"'<>]+/g)) addLink(m[0]);

      let intLinkCount = 0;
      let extLinkCount = 0;
      for (const href of links) {
        if (/blog\.naver\.com|m\.blog\.naver\.com/i.test(href)) {
          intLinkCount += 1;
          continue;
        }
        if (/^https?:\/\//i.test(href) && !/naver\.com|naver\.me|pstatic\.net|blogfiles\.naver\.net/i.test(href)) {
          extLinkCount += 1;
        }
      }

      let commentCount =
        apiComment ??
        scriptNum([
          /listNumComment\s*[=:]\s*['"]?(\d+)/i,
          /commentCount\s*[=:]\s*['"]?(\d+)/i,
          /"commentCnt"\s*:\s*(\d+)/,
          /commentCnt\s*[=:]\s*['"]?(\d+)/i,
        ]);

      if (commentCount == null) {
        const dom =
          document.querySelector('#commentCount, .comment_count, .total_comment, .u_cbox_count')?.textContent ??
          '';
        commentCount = parseNum(dom.replace(/[^\d]/g, ''));
      }
      if (commentCount == null) {
        const m = document.body.innerText.match(/댓글\s*([\d,]+)/);
        commentCount = m ? parseNum(m[1]) : 0;
      }

      let likeCount =
        apiLike ??
        scriptNum([
          /sympathyCount\s*[=:]\s*['"]?(\d+)/i,
          /"sympathyCnt"\s*:\s*(\d+)/,
          /sympathyCnt\s*[=:]\s*['"]?(\d+)/i,
        ]);

      if (likeCount == null) {
        const dom =
          document.querySelector('#sympathyCount, .u_cnt._count, .sympathy_btn .count, .like_count')
            ?.textContent ?? '';
        likeCount = parseNum(dom.replace(/[^\d]/g, ''));
      }
      if (likeCount == null) {
        const m = document.body.innerText.match(/공감\s*([\d,]+)/);
        likeCount = m ? parseNum(m[1]) : 0;
      }

      return {
        char_count: contentText.length,
        img_count: imgCount,
        video_count: videoCount,
        quote_count: quoteCount,
        comment_count: commentCount ?? 0,
        like_count: likeCount ?? 0,
        gif_count: gifCount,
        map_count: mapCount,
        hidden_count: hiddenCount,
        int_link_count: intLinkCount,
        ext_link_count: extLinkCount,
      };
    },
    { blogId, postNo },
  );
}

async function scrapeOuterEngagement(page: Page): Promise<Partial<PostContentStats>> {
  return page.evaluate(() => {
    const parseNum = (raw: unknown): number => {
      if (raw == null) return 0;
      const n = Number(String(raw).replace(/,/g, '').trim());
      return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
    };

    const html = document.documentElement.innerHTML;
    let commentCount = parseNum(document.querySelector('#commentCount, .comment_count')?.textContent);
    let likeCount = parseNum(document.querySelector('#sympathyCount, em#sympathyCount')?.textContent);

    if (!commentCount) {
      const m = html.match(/commentCnt['":\s]+(\d+)/i) ?? html.match(/listNumComment\s*[=:]\s*['"]?(\d+)/i);
      commentCount = m ? parseNum(m[1]) : 0;
    }
    if (!likeCount) {
      const m = html.match(/sympathyCnt['":\s]+(\d+)/i) ?? html.match(/sympathyCount['":\s]+(\d+)/i);
      likeCount = m ? parseNum(m[1]) : 0;
    }

    return { comment_count: commentCount, like_count: likeCount };
  });
}

/**
 * blog.naver.com PostView(mainFrame) + m.blog 폴백 — 본문 메타·댓글·공감 실측
 * method: 'desktop-mainFrame' + 'm.blog-post-view'
 */
export async function scrapePostContentStats(
  page: Page,
  blogId: string,
  postNo: string,
): Promise<PostContentStats> {
  const desktopUrl = `https://blog.naver.com/${blogId}/${postNo}`;
  await page.goto(desktopUrl, { waitUntil: 'domcontentloaded' });
  await sleep(1200);

  if (await detectBlogCheckCaptcha(page)) {
    throw new BlogCheckCaptchaError(blogId);
  }

  const mainFrame = page.frame({ name: 'mainFrame' });
  if (mainFrame) {
    await mainFrame.waitForLoadState('domcontentloaded', { timeout: 12_000 }).catch(() => {});
    await sleep(700);
  }

  const outerEngagement = await scrapeOuterEngagement(page);
  let stats = mainFrame
    ? await evaluatePostStats(mainFrame, blogId, postNo)
    : await evaluatePostStats(page, blogId, postNo);

  stats = mergePostContentStats(stats, outerEngagement);

  if (stats.char_count <= 0) {
    await page.goto(`https://m.blog.naver.com/${blogId}/${postNo}`, { waitUntil: 'domcontentloaded' });
    await sleep(900);

    if (await detectBlogCheckCaptcha(page)) {
      throw new BlogCheckCaptchaError(blogId);
    }

    const mobileStats = await evaluatePostStats(page, blogId, postNo);
    stats = mergePostContentStats(stats, mobileStats);
  }

  return stats;
}
