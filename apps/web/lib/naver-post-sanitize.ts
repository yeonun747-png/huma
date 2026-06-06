import type { ContentType } from '@huma/shared';

/** 네이버 블로그에 타이핑·표시할 때 제거할 마크다운·영상 미리보기 푸터 */
export function sanitizeBlogPostForNaver(
  raw: string,
  options?: { contentType?: ContentType },
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

  text = text.replace(/\n{3,}/g, '\n\n').trim();
  return text;
}

/** 타이핑 시뮬에 쓸 단락 배열 (빈 단락 제외) */
export function splitNaverParagraphs(body: string, options?: { contentType?: ContentType }): string[] {
  return sanitizeBlogPostForNaver(body, options)
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
}
