/** YouTube Shorts — 제목+해시태그 / 설명 (구 caption_youtube 단일 필드 호환) */

function sanitizeYoutubeShortsTitle(title: string): string {
  return title
    .replace(/#Shorts\b/gi, '')
    .replace(/#쇼츠\b/gi, '')
    .replace(/\bShorts\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function resolveYoutubeShortsCaptionFields(row: {
  caption_youtube_title?: string | null;
  caption_youtube_description?: string | null;
  caption_youtube?: string | null;
}): { title: string; description: string } {
  const title = sanitizeYoutubeShortsTitle(row.caption_youtube_title?.trim() ?? '');
  const description = row.caption_youtube_description?.trim() ?? '';
  if (title || description) {
    return { title, description };
  }
  return { title: '', description: row.caption_youtube?.trim() ?? '' };
}
