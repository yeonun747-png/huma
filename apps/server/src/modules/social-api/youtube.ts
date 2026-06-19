import fs from 'fs';
import { google } from 'googleapis';
import { supabase } from '../../middleware/auth.js';
import { getDailyLimit } from '../../lib/limits.js';
import { logOperation } from '../../lib/log-emitter.js';

import { workspaceEnv } from './workspace-credentials.js';

function getYouTubeClient(workspace: string) {
  const clientId = workspaceEnv(workspace, 'YOUTUBE_CLIENT_ID');
  const clientSecret = workspaceEnv(workspace, 'YOUTUBE_CLIENT_SECRET');
  const refreshToken = workspaceEnv(workspace, 'YOUTUBE_REFRESH_TOKEN');
  if (!clientId || !clientSecret || !refreshToken) return null;

  const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
  oauth2.setCredentials({ refresh_token: refreshToken });
  return google.youtube({ version: 'v3', auth: oauth2 });
}

async function countTodayYouTubeUploads(workspace: string): Promise<number> {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const { count } = await supabase
    .from('huma_video_queue')
    .select('*', { count: 'exact', head: true })
    .eq('workspace', workspace)
    .not('youtube_result_url', 'is', null)
    .gte('updated_at', start.toISOString());
  return count ?? 0;
}

export async function uploadYouTubeShorts(params: {
  workspace: string;
  videoPath: string;
  title: string;
  description: string;
  hashtags: string[];
}): Promise<string | undefined> {
  const youtube = getYouTubeClient(params.workspace);
  if (!youtube) {
    await logOperation({
      level: 'warn',
      message: `YouTube 자격증명 없음 — ${params.workspace} 업로드 스킵`,
      workspace: params.workspace,
      platform: 'youtube',
    });
    return undefined;
  }

  const dailyLimit = getDailyLimit('youtube_upload');
  const todayCount = await countTodayYouTubeUploads(params.workspace);
  if (todayCount >= dailyLimit) {
    await logOperation({
      level: 'warn',
      message: `YouTube 일 할당량 초과 (${todayCount}/${dailyLimit}) — 업로드 스킵`,
      workspace: params.workspace,
      platform: 'youtube',
    });
    return undefined;
  }

  const tagLine = params.hashtags.map((h) => (h.startsWith('#') ? h : `#${h}`)).join(' ');
  const shortsTags = tagLine.includes('#Shorts') ? tagLine : `${tagLine} #Shorts`.trim();
  const fullTitle = `${params.title}`.slice(0, 90);
  const description = `${params.description}\n\n${shortsTags}`.slice(0, 5000);

  try {
    const res = await youtube.videos.insert({
      part: ['snippet', 'status'],
      requestBody: {
        snippet: {
          title: fullTitle,
          description,
          categoryId: '22',
        },
        status: {
          privacyStatus: 'public',
          selfDeclaredMadeForKids: false,
        },
      },
      media: {
        body: fs.createReadStream(params.videoPath),
      },
    });

    const videoId = res.data.id;
    if (!videoId) return undefined;
    return `https://www.youtube.com/watch?v=${videoId}`;
  } catch (err) {
    await logOperation({
      level: 'warn',
      message: `YouTube Shorts 업로드 실패: ${(err as Error).message}`,
      workspace: params.workspace,
      platform: 'youtube',
    });
    return undefined;
  }
}
