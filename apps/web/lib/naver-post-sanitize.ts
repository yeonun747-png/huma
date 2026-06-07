import type { ContentType } from '@huma/shared';

import { formatBlogLinkLabel, resolveBlogLinkUrl } from '@/lib/blog-link';

/** 연운 기본 붙여넣기 URL (OG 카드) */
export const YEONUN_BLOG_PASTE_URL = 'https://yeonun.com';

/** UI 짧은 표시용 */
export const YEONUN_BLOG_LINK_TEXT = 'yeonun.com';

export function normalizeBlogLink(url?: string | null, workspace?: string | null): string {
  const ws = workspace ?? 'yeonun';
  return resolveBlogLinkUrl(ws, url, url);
}

/** 시뮬레이터·미리보기 — resolveBlogLinkUrl 과 동일 (연운은 https 전체 URL) */
export function resolveSimulatorBlogLink(url?: string | null, workspace?: string | null): string {
  return normalizeBlogLink(url, workspace);
}

export { formatBlogLinkLabel };

/** 본문에서 별도 타이핑할 링크·URL 제거 */
export function stripEmbeddedBlogLinks(raw: string, linkUrl?: string | null): string {
  let text = raw;
  const variants = new Set<string>();
  if (linkUrl?.trim()) {
    variants.add(linkUrl.trim());
    try {
      const u = new URL(linkUrl.startsWith('http') ? linkUrl : `https://${linkUrl}`);
      variants.add(u.hostname.replace(/^www\./, ''));
      variants.add(`${u.hostname}${u.pathname}`);
    } catch {
      /* ignore */
    }
  }
  variants.add('yeonun.com');
  variants.add('www.yeonun.com');
  variants.add('https://yeonun.com');
  variants.add('https://www.yeonun.com');
  variants.add('http://yeonun.com');

  for (const v of variants) {
    text = text.replace(new RegExp(v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '');
  }
  text = text.replace(/https?:\/\/[^\s\n]+/gi, '');
  return text;
}

/** 네이버 블로그에 타이핑·표시할 때 제거할 마크다운·영상 미리보기 푸터 */
export function sanitizeBlogPostForNaver(
  raw: string,
  options?: { contentType?: ContentType; linkUrl?: string | null },
): string {
  let text = raw;

  // 구분선 (---, ***, ___)
  text = text.replace(/^[\s]*[-*_]{3,}[\s]*$/gm, '');

  // 굵게/기울임
  text = text.replace(/\*\*([^*]+)\*\*/g, '$1');
  text = text.replace(/__([^_]+)__/g, '$1');
  text = text.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '$1');
  text = text.replace(/(?<!_)_([^_\n]+)_(?!_)/g, '$1');

  // 헤더·인용
  text = text.replace(/^#{1,6}\s+/gm, '');
  text = text.replace(/^>\s?/gm, '');

  // 타입 A — 영상 미리보기 푸터 제거
  if (options?.contentType !== 'B') {
    text = text.replace(/\n*▶\s*Kling[^\n]*/gi, '');
    text = text.replace(/\n*▶\s*Seedance[^\n]*/gi, '');
    text = text.replace(/\n*🎥[^\n]*(Shorts|쇼츠|릴스)[^\n]*/gi, '');
  }

  text = stripEmbeddedBlogLinks(text, options?.linkUrl);
  text = text.replace(/\n{3,}/g, '\n\n').trim();
  return text;
}

/** 타이핑 시뮬에 쓸 단락 배열 (빈 단락 제외) */
export function splitNaverParagraphs(
  body: string,
  options?: { contentType?: ContentType; linkUrl?: string | null },
): string[] {
  return sanitizeBlogPostForNaver(body, options)
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/** Playwright postNaverBlog 와 동일 본문·링크 준비 */
export function prepareBlogPostForPlaywright(
  raw: string,
  workspace: string,
  sourceLink?: string | null,
  contentType?: ContentType,
): { content: string; linkUrl: string | undefined } {
  const linkUrl = resolveBlogLinkUrl(workspace, sourceLink ?? '', sourceLink ?? '');
  const content = sanitizeBlogPostForNaver(raw, { contentType, linkUrl });
  return { content, linkUrl: linkUrl || undefined };
}

/** @deprecated prepareBlogPostForPlaywright 사용 */
export function prepareBodyForTypingSim(
  body: string,
  options?: { contentType?: ContentType; linkUrl?: string | null },
): string {
  return sanitizeBlogPostForNaver(body, options);
}
