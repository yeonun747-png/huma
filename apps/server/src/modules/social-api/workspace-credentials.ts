/** yeonun · quizoasis · panana — .env 접미사 (YouTube와 동일) */
export const WORKSPACE_ENV_SUFFIX: Record<string, string> = {
  yeonun: 'YEONUN',
  quizoasis: 'QUIZOASIS',
  panana: 'PANANA',
};

export function workspaceEnvSuffix(workspace: string): string | null {
  return WORKSPACE_ENV_SUFFIX[workspace] ?? null;
}

/** WORKSPACE_KEY → KEY_YEONUN … 없으면 전역 KEY 폴백 */
export function workspaceEnv(workspace: string, key: string): string | undefined {
  const suffix = workspaceEnvSuffix(workspace);
  if (suffix) {
    const scoped = process.env[`${key}_${suffix}`]?.trim();
    if (scoped) return scoped;
  }
  return process.env[key]?.trim() || undefined;
}

export interface TikTokCredentials {
  clientKey: string;
  clientSecret: string;
  accessToken: string;
  refreshToken?: string;
  username?: string;
}

export interface MetaCredentials {
  appId: string;
  appSecret: string;
  accessToken: string;
  platformUserId: string;
}

export interface TwitterCredentials {
  apiKey: string;
  apiSecret: string;
  accessToken: string;
  accessSecret: string;
}

function metaUserIdKey(platform: string): string {
  if (platform === 'threads') return 'META_THREADS_USER_ID';
  if (platform === 'instagram_en') return 'META_IG_USER_ID_EN';
  if (platform === 'instagram_kr') return 'META_IG_USER_ID_KR';
  return 'META_IG_USER_ID';
}

export function resolveTikTokCredentials(
  workspace: string,
  db?: { access_token?: string; refresh_token?: string | null; username?: string },
): TikTokCredentials | null {
  const clientKey = workspaceEnv(workspace, 'TIKTOK_CLIENT_KEY');
  const clientSecret = workspaceEnv(workspace, 'TIKTOK_CLIENT_SECRET');
  const accessToken = workspaceEnv(workspace, 'TIKTOK_ACCESS_TOKEN') ?? db?.access_token;
  if (!clientKey || !clientSecret || !accessToken) return null;
  return {
    clientKey,
    clientSecret,
    accessToken,
    refreshToken: workspaceEnv(workspace, 'TIKTOK_REFRESH_TOKEN') ?? db?.refresh_token ?? undefined,
    username: db?.username,
  };
}

export function resolveMetaCredentials(
  workspace: string,
  platform: string,
  db?: { access_token?: string; platform_user_id?: string | null },
): MetaCredentials | null {
  const appId = workspaceEnv(workspace, 'META_APP_ID');
  const appSecret = workspaceEnv(workspace, 'META_APP_SECRET');
  const accessToken = workspaceEnv(workspace, 'META_ACCESS_TOKEN') ?? db?.access_token;
  const platformUserId = workspaceEnv(workspace, metaUserIdKey(platform)) ?? db?.platform_user_id ?? undefined;
  if (!appId || !appSecret || !accessToken || !platformUserId) return null;
  return { appId, appSecret, accessToken, platformUserId };
}

export function resolveTwitterCredentials(
  workspace: string,
  db?: { access_token?: string; refresh_token?: string | null },
): TwitterCredentials | null {
  const apiKey = workspaceEnv(workspace, 'TWITTER_API_KEY');
  const apiSecret = workspaceEnv(workspace, 'TWITTER_API_SECRET');
  const accessToken = workspaceEnv(workspace, 'TWITTER_ACCESS_TOKEN') ?? db?.access_token;
  const accessSecret = workspaceEnv(workspace, 'TWITTER_ACCESS_SECRET') ?? db?.refresh_token ?? undefined;
  if (!apiKey || !apiSecret || !accessToken || !accessSecret) return null;
  return { apiKey, apiSecret, accessToken, accessSecret };
}
