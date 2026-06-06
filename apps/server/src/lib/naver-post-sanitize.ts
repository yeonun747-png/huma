import type { ContentType } from '@huma/shared';

import { resolveBlogLinkUrl } from './blog-link.js';

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

export function sanitizeBlogPostForNaver(
  raw: string,
  options?: { contentType?: ContentType; linkUrl?: string | null },
): string {
  let text = raw;

  text = text.replace(/^[\s]*[-*_]{3,}[\s]*$/gm, '');
  text = text.replace(/\*\*([^*]+)\*\*/g, '$1');
  text = text.replace(/__([^_]+)__/g, '$1');
  text = text.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '$1');
  text = text.replace(/(?<!_)_([^_\n]+)_(?!_)/g, '$1');
  text = text.replace(/^#{1,6}\s+/gm, '');
  text = text.replace(/^>\s?/gm, '');

  if (options?.contentType !== 'B') {
    text = text.replace(/\n*▶\s*Kling[^\n]*/gi, '');
    text = text.replace(/\n*▶\s*Seedance[^\n]*/gi, '');
    text = text.replace(/\n*🎥[^\n]*(Shorts|쇼츠|릴스)[^\n]*/gi, '');
  }

  text = stripEmbeddedBlogLinks(text, options?.linkUrl);
  text = text.replace(/\n{3,}/g, '\n\n').trim();
  return text;
}

export function prepareBlogPostForPlaywright(
  raw: string,
  workspace: string,
  sourceLink?: string | null,
  contentType?: ContentType,
): { content: string; linkUrl: string | undefined } {
  const linkUrl = resolveBlogLinkUrl(workspace, sourceLink ?? '');
  const content = sanitizeBlogPostForNaver(raw, { contentType, linkUrl });
  return { content, linkUrl: linkUrl || undefined };
}
