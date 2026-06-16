import { supabase } from '../../middleware/auth.js';
import { extractPostNoFromUrl, plainTextLength, resolveExtLinkCount } from './blog-url.js';

export interface RecordPublishedPostInput {
  accountId: string;
  resultUrl: string;
  title?: string | null;
  content?: string | null;
  linkUrl?: string | null;
  imageUrls?: string[] | null;
  publishedAt?: string | null;
  workspace?: string | null;
}

/** post_blog 발행 완료 시 posts 테이블에 기록 */
export async function recordPublishedPost(input: RecordPublishedPostInput): Promise<void> {
  const postUrl = input.resultUrl.trim();
  if (!postUrl || !input.accountId) return;

  const postNo = extractPostNoFromUrl(postUrl);
  const publishedAt = input.publishedAt ?? new Date().toISOString();

  const { error } = await supabase.from('posts').upsert(
    {
      account_id: input.accountId,
      post_url: postUrl,
      post_no: postNo,
      title: input.title ?? null,
      published_at: publishedAt,
      char_count: plainTextLength(input.content),
      img_count: input.imageUrls?.length ?? 0,
      ext_link_count: resolveExtLinkCount(input.content, input.linkUrl, input.workspace),
      ext_link_cleared: false,
    },
    { onConflict: 'account_id,post_url' },
  );

  if (error) {
    console.error('[posts] recordPublishedPost failed:', error.message);
  }
}
