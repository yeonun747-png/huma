import {
  uploadToPlatform,
  postToThreads,
  postToTwitter,
  replyToThreads,
  replyToTwitter,
  uploadInstagramImage,
} from '../../social-api/index.js';
import { sanitizeSocialReplyLink } from '../../../lib/social-reply-chain.js';

export async function executeSocialPost(
  type: string,
  payload: Record<string, unknown>,
): Promise<string | undefined> {
  switch (type) {
    case 'tiktok_upload':
      return uploadToPlatform('tiktok', payload as { workspace: string; videoPath: string; caption: string; hashtags: string[] });
    case 'instagram_reel':
      return uploadToPlatform('instagram', payload as { workspace: string; videoPath: string; caption: string; hashtags: string[] });
    case 'instagram_post':
      await uploadInstagramImage({
        workspace: payload.workspace as string,
        imageUrl: (payload.imageUrl as string) || (payload.imageUrls as string[])?.[0],
        caption: (payload.caption as string) || (payload.content as string) || '',
        hashtags: (payload.hashtags as string[]) || [],
      });
      return undefined;
    case 'threads_post':
      return postToThreads({
        workspace: payload.workspace as string,
        text: (payload.text as string) || (payload.content as string) || '',
        imageUrl: payload.imageUrl as string | undefined,
      });
    case 'threads_reply':
      return replyToThreads({
        workspace: payload.workspace as string,
        parentPostId: payload.parentPostId as string,
        text: sanitizeSocialReplyLink(String(payload.linkUrl ?? payload.text ?? '')),
      });
    case 'twitter_post':
      return postToTwitter({
        workspace: payload.workspace as string,
        text: (payload.text as string) || (payload.content as string) || '',
        imageUrls: payload.imageUrls as string[] | undefined,
      });
    case 'twitter_reply':
      return replyToTwitter({
        workspace: payload.workspace as string,
        parentTweetId: payload.parentPostId as string,
        text: sanitizeSocialReplyLink(String(payload.linkUrl ?? payload.text ?? '')),
      });
    case 'pinterest_upload':
      return uploadToPlatform('pinterest', {
        workspace: payload.workspace as string,
        videoPath: payload.videoPath as string,
        caption: (payload.caption as string) || (payload.content as string) || '',
        hashtags: (payload.hashtags as string[]) || [],
        title: payload.title as string | undefined,
        description: payload.description as string | undefined,
        linkUrl: payload.linkUrl as string | undefined,
      });
    default:
      throw new Error(`Unknown social job: ${type}`);
  }
}
