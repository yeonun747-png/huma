import axios from 'axios';
import fs from 'fs';
import { supabase } from '../../middleware/auth.js';
import { sleep } from '../../lib/utils.js';
import { uploadYouTubeShorts } from './youtube.js';
import { uploadPinterestVideoPin } from './pinterest.js';
import {
  resolveMetaCredentials,
  resolveTikTokCredentials,
  resolveTwitterCredentials,
} from './workspace-credentials.js';

type PlatformAccountRow = {
  id: string;
  platform: string;
  username: string;
  access_token: string;
  refresh_token?: string | null;
  platform_user_id?: string | null;
  token_expires_at?: string | null;
};

async function getPlatformAccountOptional(
  workspace: string,
  platform: string,
): Promise<PlatformAccountRow | null> {
  const { data } = await supabase
    .from('huma_platform_accounts')
    .select('*')
    .eq('workspace', workspace)
    .eq('platform', platform)
    .eq('is_active', true)
    .maybeSingle();
  return (data as PlatformAccountRow | null) ?? null;
}

async function getPlatformAccount(workspace: string, platform: string): Promise<PlatformAccountRow> {
  const row = await getPlatformAccountOptional(workspace, platform);
  if (!row) throw new Error(`${platform} 계정 없음: ${workspace} (계정관리에 채널 등록 필요)`);
  return row;
}

async function refreshTikTokAccessToken(
  workspace: string,
  account: PlatformAccountRow,
): Promise<string> {
  const creds = resolveTikTokCredentials(workspace, account);
  if (!creds?.refreshToken) return creds?.accessToken ?? account.access_token;

  const { data } = await axios.post(
    'https://open.tiktokapis.com/v2/oauth/token/',
    new URLSearchParams({
      client_key: creds.clientKey,
      client_secret: creds.clientSecret,
      grant_type: 'refresh_token',
      refresh_token: creds.refreshToken,
    }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
  );
  const token = data.data?.access_token ?? data.access_token;
  const refresh = data.data?.refresh_token ?? data.refresh_token ?? creds.refreshToken;
  const expiresIn = data.data?.expires_in ?? data.expires_in ?? 86400;
  if (account.id && !account.access_token.startsWith('env-managed')) {
    await supabase
      .from('huma_platform_accounts')
      .update({
        access_token: token,
        refresh_token: refresh,
        token_expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
      })
      .eq('id', account.id);
  }
  return token;
}

async function refreshMetaAccessToken(workspace: string, account: PlatformAccountRow): Promise<string> {
  const creds = resolveMetaCredentials(workspace, account.platform, account);
  if (!creds) return account.access_token;

  const { data } = await axios.get('https://graph.facebook.com/v19.0/oauth/access_token', {
    params: {
      grant_type: 'fb_exchange_token',
      client_id: creds.appId,
      client_secret: creds.appSecret,
      fb_exchange_token: creds.accessToken,
    },
  });
  if (account.id && !account.access_token.startsWith('env-managed')) {
    await supabase
      .from('huma_platform_accounts')
      .update({
        access_token: data.access_token,
        token_expires_at: new Date(Date.now() + (data.expires_in ?? 5184000) * 1000).toISOString(),
      })
      .eq('id', account.id);
  }
  return data.access_token as string;
}

async function resolveAccessToken(
  workspace: string,
  account: PlatformAccountRow,
): Promise<string> {
  const envTikTok = resolveTikTokCredentials(workspace, account);
  if (account.platform === 'tiktok' && envTikTok) {
    if (!account.token_expires_at || new Date(account.token_expires_at) <= new Date(Date.now() + 7 * 24 * 3600 * 1000)) {
      if (envTikTok.refreshToken) return refreshTikTokAccessToken(workspace, account);
    }
    return envTikTok.accessToken;
  }

  const metaPlatforms = ['instagram', 'instagram_en', 'instagram_kr', 'threads'];
  if (metaPlatforms.includes(account.platform)) {
    const meta = resolveMetaCredentials(workspace, account.platform, account);
    if (meta) {
      if (
        account.token_expires_at &&
        new Date(account.token_expires_at) <= new Date(Date.now() + 7 * 24 * 3600 * 1000)
      ) {
        return refreshMetaAccessToken(workspace, account);
      }
      return meta.accessToken;
    }
  }

  if (!account.token_expires_at) return account.access_token;
  if (new Date(account.token_expires_at) > new Date(Date.now() + 7 * 24 * 3600 * 1000)) {
    return account.access_token;
  }
  if (!account.refresh_token) return account.access_token;

  if (account.platform === 'tiktok') return refreshTikTokAccessToken(workspace, account);
  if (metaPlatforms.includes(account.platform)) return refreshMetaAccessToken(workspace, account);
  return account.access_token;
}

/** @deprecated 내부용 — resolveAccessToken 사용 */
export async function refreshTokenIfNeeded(account: {
  id: string;
  platform: string;
  access_token: string;
  refresh_token?: string;
  token_expires_at?: string;
} & { workspace?: string }): Promise<string> {
  const workspace = account.workspace ?? '';
  return resolveAccessToken(workspace, account as PlatformAccountRow);
}

export async function uploadTikTokVideo(params: {
  workspace: string;
  videoPath: string;
  caption: string;
  hashtags: string[];
}): Promise<string | undefined> {
  const account = await getPlatformAccount(params.workspace, 'tiktok');
  const creds = resolveTikTokCredentials(params.workspace, account);
  if (!creds) {
    throw new Error(`TikTok .env 자격증명 없음: ${params.workspace} (TIKTOK_CLIENT_KEY/SECRET/ACCESS_TOKEN_${params.workspace.toUpperCase()})`);
  }
  const token = await resolveAccessToken(params.workspace, account);
  const videoStat = fs.statSync(params.videoPath);
  let tags = params.hashtags;
  if (params.workspace === 'quizoasis') {
    const { buildQuizOasisTikTokHashtags } = await import('../social/quizoasis-reels.js');
    tags = buildQuizOasisTikTokHashtags(params.hashtags);
  }
  const fullCaption = `${params.caption}\n${tags.map((h) => `#${h.replace(/^#/, '')}`).join(' ')}`;

  const { data: init } = await axios.post(
    'https://open.tiktokapis.com/v2/post/publish/video/init/',
    {
      post_info: { title: fullCaption.slice(0, 2200), privacy_level: 'PUBLIC_TO_EVERYONE', video_cover_timestamp_ms: 1000 },
      source_info: { source: 'FILE_UPLOAD', video_size: videoStat.size, chunk_size: videoStat.size, total_chunk_count: 1 },
    },
    { headers: { Authorization: `Bearer ${token}` } },
  );

  await axios.put(init.data.upload_url, fs.readFileSync(params.videoPath), {
    headers: { 'Content-Type': 'video/mp4', 'Content-Range': `bytes 0-${videoStat.size - 1}/${videoStat.size}` },
  });

  for (let i = 0; i < 30; i++) {
    await sleep(3000);
    const { data: s } = await axios.post(
      'https://open.tiktokapis.com/v2/post/publish/status/fetch/',
      { publish_id: init.data.publish_id },
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (s.data.status === 'PUBLISH_COMPLETE') {
      return s.data.publicaly_available_post_id
        ? `https://www.tiktok.com/@${account.username}/video/${s.data.publicaly_available_post_id}`
        : undefined;
    }
    if (s.data.status === 'FAILED') throw new Error('TikTok 발행 실패');
  }
  return undefined;
}

export async function uploadInstagramReel(params: {
  workspace: string;
  videoPath: string;
  caption: string;
  hashtags: string[];
  platform?: string;
}): Promise<string | undefined> {
  const platformKey = params.platform ?? 'instagram';
  const account = await getPlatformAccount(params.workspace, platformKey);
  const meta = resolveMetaCredentials(params.workspace, platformKey, account);
  if (!meta) {
    throw new Error(
      `Instagram .env 자격증명 없음: ${params.workspace} (META_APP_ID/SECRET/ACCESS_TOKEN/META_IG_USER_ID)`,
    );
  }
  const token = await resolveAccessToken(params.workspace, account);
  const fullCaption = `${params.caption}\n.\n.\n${params.hashtags.map((h) => `#${h}`).join(' ')}`;
  const videoUrl = await uploadToSupabaseStorage(params.videoPath);

  const { data: c } = await axios.post(
    `https://graph.facebook.com/v19.0/${meta.platformUserId}/media`,
    { media_type: 'REELS', video_url: videoUrl, caption: fullCaption, share_to_feed: true },
    { params: { access_token: token } },
  );

  for (let i = 0; i < 20; i++) {
    await sleep(5000);
    const { data: s } = await axios.get(`https://graph.facebook.com/v19.0/${c.id}`, {
      params: { fields: 'status_code', access_token: token },
    });
    if (s.status_code === 'FINISHED') break;
    if (s.status_code === 'ERROR') throw new Error('Instagram 컨테이너 오류');
  }

  const { data: published } = await axios.post(
    `https://graph.facebook.com/v19.0/${meta.platformUserId}/media_publish`,
    { creation_id: c.id },
    { params: { access_token: token } },
  );

  try {
    const { data: media } = await axios.get(`https://graph.facebook.com/v19.0/${published.id}`, {
      params: { fields: 'permalink', access_token: token },
    });
    return media.permalink as string | undefined;
  } catch {
    return undefined;
  }
}

export async function uploadInstagramImage(params: {
  workspace: string;
  imageUrl: string;
  caption: string;
  hashtags: string[];
}) {
  const account = await getPlatformAccount(params.workspace, 'instagram');
  const meta = resolveMetaCredentials(params.workspace, 'instagram', account);
  if (!meta) throw new Error(`Instagram .env 자격증명 없음: ${params.workspace}`);
  const token = await resolveAccessToken(params.workspace, account);
  const fullCaption = `${params.caption}\n${params.hashtags.map((h) => `#${h}`).join(' ')}`;
  const { data: c } = await axios.post(
    `https://graph.facebook.com/v19.0/${meta.platformUserId}/media`,
    { image_url: params.imageUrl, caption: fullCaption },
    { params: { access_token: token } },
  );
  await axios.post(
    `https://graph.facebook.com/v19.0/${meta.platformUserId}/media_publish`,
    { creation_id: c.id },
    { params: { access_token: token } },
  );
}

/** ㉝ — 본문에 외부 링크 삽입 금지 (linkUrl 무시) */
export async function postToThreads(params: {
  workspace: string;
  text: string;
  imageUrl?: string;
  linkUrl?: string;
}): Promise<string> {
  const account = await getPlatformAccount(params.workspace, 'threads');
  const meta = resolveMetaCredentials(params.workspace, 'threads', account);
  if (!meta) {
    throw new Error(
      `Threads .env 자격증명 없음: ${params.workspace} (META_ACCESS_TOKEN/META_THREADS_USER_ID)`,
    );
  }
  const token = await resolveAccessToken(params.workspace, account);
  const containerParams: Record<string, string> = {
    media_type: params.imageUrl ? 'IMAGE' : 'TEXT',
    text: params.text,
  };
  if (params.imageUrl) containerParams.image_url = params.imageUrl;

  const { data: c } = await axios.post(
    `https://graph.threads.net/v1.0/${meta.platformUserId}/threads`,
    containerParams,
    { params: { access_token: token } },
  );
  await sleep(1000);
  const { data: published } = await axios.post(
    `https://graph.threads.net/v1.0/${meta.platformUserId}/threads_publish`,
    { creation_id: c.id },
    { params: { access_token: token } },
  );
  return String(published.id);
}

/** ㉞ — 발행 직후 첫 댓글(reply)로 TikTok URL만 */
export async function replyToThreads(params: {
  workspace: string;
  parentPostId: string;
  text: string;
}): Promise<string> {
  const account = await getPlatformAccount(params.workspace, 'threads');
  const meta = resolveMetaCredentials(params.workspace, 'threads', account);
  if (!meta) throw new Error(`Threads .env 자격증명 없음: ${params.workspace}`);
  const token = await resolveAccessToken(params.workspace, account);
  const { data: c } = await axios.post(
    `https://graph.threads.net/v1.0/${meta.platformUserId}/threads`,
    {
      media_type: 'TEXT',
      text: params.text,
      reply_to_id: params.parentPostId,
    },
    { params: { access_token: token } },
  );
  await sleep(1000);
  const { data: published } = await axios.post(
    `https://graph.threads.net/v1.0/${meta.platformUserId}/threads_publish`,
    { creation_id: c.id },
    { params: { access_token: token } },
  );
  return String(published.id);
}

/** ㉝ — 본문에 외부 링크 삽입 금지 (linkUrl 무시) */
export async function postToTwitter(params: {
  workspace: string;
  text: string;
  imageUrls?: string[];
  linkUrl?: string;
}): Promise<string> {
  const account = await getPlatformAccount(params.workspace, 'twitter');
  const creds = resolveTwitterCredentials(params.workspace, account);
  if (!creds) {
    throw new Error(
      `X .env 자격증명 없음: ${params.workspace} (TWITTER_API_KEY/SECRET/ACCESS_TOKEN/ACCESS_SECRET)`,
    );
  }
  const { TwitterApi } = await import('twitter-api-v2');
  const client = new TwitterApi({
    appKey: creds.apiKey,
    appSecret: creds.apiSecret,
    accessToken: creds.accessToken,
    accessSecret: creds.accessSecret,
  });
  const { data } = await client.v2.tweet({ text: params.text.slice(0, 280) });
  return data.id;
}

/** ㉞ — 발행 직후 첫 댓글(reply)로 TikTok URL만 */
export async function replyToTwitter(params: {
  workspace: string;
  parentTweetId: string;
  text: string;
}): Promise<string> {
  const account = await getPlatformAccount(params.workspace, 'twitter');
  const creds = resolveTwitterCredentials(params.workspace, account);
  if (!creds) throw new Error(`X .env 자격증명 없음: ${params.workspace}`);
  const { TwitterApi } = await import('twitter-api-v2');
  const client = new TwitterApi({
    appKey: creds.apiKey,
    appSecret: creds.apiSecret,
    accessToken: creds.accessToken,
    accessSecret: creds.accessSecret,
  });
  const { data } = await client.v2.tweet({
    text: params.text.slice(0, 280),
    reply: { in_reply_to_tweet_id: params.parentTweetId },
  });
  return data.id;
}

async function uploadToSupabaseStorage(filePath: string): Promise<string> {
  const { createClient } = await import('@supabase/supabase-js');
  const supa = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
  const fileName = `videos/${Date.now()}.mp4`;
  const fileBuffer = fs.readFileSync(filePath);
  await supa.storage.from('huma-media').upload(fileName, fileBuffer, { contentType: 'video/mp4', upsert: true });
  const { data } = supa.storage.from('huma-media').getPublicUrl(fileName);
  return data.publicUrl;
}

export async function uploadToPlatform(
  platform: string,
  params: {
    workspace: string;
    videoPath: string;
    caption: string;
    hashtags: string[];
    title?: string;
    description?: string;
    linkUrl?: string;
  },
) {
  switch (platform) {
    case 'tiktok':
      return uploadTikTokVideo(params);
    case 'instagram':
    case 'instagram_reel':
      return uploadInstagramReel(params);
    case 'youtube':
      return uploadYouTubeShorts({
        workspace: params.workspace,
        videoPath: params.videoPath,
        title: params.title ?? params.caption.slice(0, 90),
        description: (params.description ?? params.caption).slice(0, 500),
        hashtags: params.hashtags,
      });
    case 'threads':
      return postToThreads({ workspace: params.workspace, text: params.caption, linkUrl: undefined });
    case 'twitter':
    case 'x':
      return postToTwitter({ workspace: params.workspace, text: params.caption });
    case 'pinterest':
      return uploadPinterestVideoPin({
        videoPath: params.videoPath,
        title: params.title ?? params.caption.slice(0, 100),
        description: (params.description ?? params.caption).slice(0, 500),
        linkUrl: params.linkUrl ?? '',
      });
    default:
      throw new Error(`지원하지 않는 플랫폼: ${platform}`);
  }
}

export { uploadPinterestVideoPin } from './pinterest.js';
export { uploadYouTubeShorts } from './youtube.js';

export { getPlatformAccount, getPlatformAccountOptional };
