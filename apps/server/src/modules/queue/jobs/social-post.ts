import { uploadToPlatform, postToThreads, postToTwitter, uploadInstagramImage } from '../../social-api/index.js';

export async function executeSocialPost(type: string, payload: Record<string, unknown>) {
  switch (type) {
    case 'tiktok_upload':
      return uploadToPlatform('tiktok', payload as { workspace: string; videoPath: string; caption: string; hashtags: string[] });
    case 'instagram_reel':
      return uploadToPlatform('instagram', payload as { workspace: string; videoPath: string; caption: string; hashtags: string[] });
    case 'instagram_post':
      return uploadInstagramImage({
        workspace: payload.workspace as string,
        imageUrl: (payload.imageUrl as string) || (payload.imageUrls as string[])?.[0],
        caption: (payload.caption as string) || (payload.content as string) || '',
        hashtags: (payload.hashtags as string[]) || [],
      });
    case 'threads_post':
      return postToThreads(payload as { workspace: string; text: string; imageUrl?: string; linkUrl?: string });
    case 'twitter_post':
      return postToTwitter(payload as { workspace: string; text: string; imageUrls?: string[]; linkUrl?: string });
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
