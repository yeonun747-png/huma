import { supabase } from '../../middleware/auth.js';
import { clearBlogPostListCacheForAccount } from './blog-post-list.js';
import { canonicalBlogPostUrl, extractPostNoFromUrl } from './blog-url.js';
import { parsePostContentStats } from './content-stats.js';
import { scheduleAutoBlogPostScan } from './schedule-auto-post-scan.js';

export interface RecordPublishedPostInput {
  accountId: string;
  resultUrl: string;
  title?: string | null;
  content?: string | null;
  linkUrl?: string | null;
  imageUrls?: string[] | null;
  publishedAt?: string | null;
  workspace?: string | null;
  hasVideo?: boolean;
}

/** post_blog 발행 완료 시 posts 테이블에 기록 */
export async function recordPublishedPost(input: RecordPublishedPostInput): Promise<void> {
  const postUrl = canonicalBlogPostUrl(input.resultUrl.trim());
  if (!postUrl || !input.accountId) return;

  const postNo = extractPostNoFromUrl(postUrl);
  const publishedAt = input.publishedAt ?? new Date().toISOString();
  const stats = parsePostContentStats(input.content, {
    linkUrl: input.linkUrl,
    workspace: input.workspace,
    imageUrls: input.imageUrls,
    hasVideo: input.hasVideo,
  });

  const { error } = await supabase.from('posts').upsert(
    {
      account_id: input.accountId,
      post_url: postUrl,
      post_no: postNo,
      title: input.title ?? null,
      published_at: publishedAt,
      char_count: stats.char_count,
      img_count: stats.img_count,
      video_count: stats.video_count,
      quote_count: stats.quote_count,
      comment_count: stats.comment_count,
      like_count: stats.like_count,
      gif_count: stats.gif_count,
      map_count: stats.map_count,
      hidden_count: stats.hidden_count,
      int_link_count: stats.int_link_count,
      ext_link_count: stats.ext_link_count,
      ext_link_cleared: false,
    },
    { onConflict: 'account_id,post_url' },
  );

  if (error) {
    console.error('[posts] recordPublishedPost failed:', error.message);
    return;
  }

  await clearBlogPostListCacheForAccount(input.accountId);

  if (postNo) {
    await scheduleAutoBlogPostScan({
      accountId: input.accountId,
      postNo,
      publishedAt,
    });
  }
}
