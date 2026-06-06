import type { ContentType } from '@huma/shared';

/** 네이버 블로그 본문에 넣을 링크 — yeonun.com 도메인만 */
export function normalizeBlogLink(_url?: string | null): string {
  return 'yeonun.com';
}

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

/** 시뮬레이터용 본문 준비 — 링크·이미지는 별도 단계 */
export function prepareBodyForTypingSim(
  body: string,
  options?: { contentType?: ContentType; linkUrl?: string | null },
): string {
  return sanitizeBlogPostForNaver(body, options);
}
