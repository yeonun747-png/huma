import { countExternalLinks, plainTextLength, resolveExtLinkCount } from './blog-url.js';

export interface PostContentStats {
  char_count: number;
  img_count: number;
  video_count: number;
  quote_count: number;
  comment_count: number;
  like_count: number;
  gif_count: number;
  map_count: number;
  hidden_count: number;
  int_link_count: number;
  ext_link_count: number;
}

function countMatches(content: string, re: RegExp): number {
  return [...content.matchAll(re)].length;
}

/** huma_jobs 본문·이미지·link_url 기준 포스트 메타 (발행 시 posts 저장용) */
export function parsePostContentStats(
  content: string | null | undefined,
  options?: {
    linkUrl?: string | null;
    workspace?: string | null;
    imageUrls?: string[] | null;
    hasVideo?: boolean;
  },
): PostContentStats {
  const text = content ?? '';
  const imgFromMarkdown = countMatches(text, /!\[[^\]]*\]\([^)]+\)/g);
  const imgCount = Math.max(options?.imageUrls?.length ?? 0, imgFromMarkdown);

  const videoFromText =
    countMatches(text, /▶\s*(Kling|Seedance)/gi) +
    countMatches(text, /🎥[^\n]*(Shorts|쇼츠|릴스)/gi) +
    countMatches(text, /https?:\/\/[^\s)]+\.(mp4|webm|mov)/gi);
  const videoCount = (options?.hasVideo ? 1 : 0) + videoFromText;

  const quoteCount = countMatches(text, /^>\s?.+/gm);
  const gifCount =
    countMatches(text, /https?:\/\/[^\s)]+\.gif/gi) + countMatches(text, /\[gif\]/gi);
  const mapCount =
    countMatches(text, /map\.naver\.com|naver\.me\/map|place\.naver\.com/gi) +
    countMatches(text, /\[지도\]/gi);
  const hiddenCount =
    countMatches(text, /\[히든\]|<!--hidden-->|\(히든\)/gi) +
    countMatches(text, /spoiler|스포일러/gi);

  const intLinkCount = countInternalBlogLinks(text);
  const extLinkCount = resolveExtLinkCount(text, options?.linkUrl, options?.workspace);

  return {
    char_count: plainTextLength(text),
    img_count: imgCount,
    video_count: videoCount,
    quote_count: quoteCount,
    comment_count: 0,
    like_count: 0,
    gif_count: gifCount,
    map_count: mapCount,
    hidden_count: hiddenCount,
    int_link_count: intLinkCount,
    ext_link_count: extLinkCount,
  };
}

function countInternalBlogLinks(content: string): number {
  const seen = new Set<string>();
  let count = 0;
  const add = (raw: string) => {
    const url = raw.trim();
    if (!url || seen.has(url)) return;
    if (!/blog\.naver\.com/i.test(url)) return;
    seen.add(url);
    count += 1;
  };

  for (const m of content.matchAll(/\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g)) add(m[2]);
  for (const m of content.matchAll(/https?:\/\/[^\s)\]"'<>]+/g)) {
    const u = m[0];
    if (/blog\.naver\.com/i.test(u)) add(u);
  }
  return count;
}

export function emptyPostContentStats(): PostContentStats {
  return {
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
}

export function mergePostContentStats(
  base: PostContentStats,
  overlay: Partial<PostContentStats>,
): PostContentStats {
  return {
    char_count: Math.max(base.char_count, overlay.char_count ?? 0),
    img_count: Math.max(base.img_count, overlay.img_count ?? 0),
    video_count: Math.max(base.video_count, overlay.video_count ?? 0),
    quote_count: Math.max(base.quote_count, overlay.quote_count ?? 0),
    comment_count: Math.max(base.comment_count, overlay.comment_count ?? 0),
    like_count: Math.max(base.like_count, overlay.like_count ?? 0),
    gif_count: Math.max(base.gif_count, overlay.gif_count ?? 0),
    map_count: Math.max(base.map_count, overlay.map_count ?? 0),
    hidden_count: Math.max(base.hidden_count, overlay.hidden_count ?? 0),
    int_link_count: Math.max(base.int_link_count, overlay.int_link_count ?? 0),
    ext_link_count: Math.max(base.ext_link_count, overlay.ext_link_count ?? 0),
  };
}
