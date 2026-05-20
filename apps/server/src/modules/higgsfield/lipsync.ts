import { higgsfieldRequest } from './client.js';

export async function generateLipsync(params: {
  videoUrl: string;
  audioUrl: string;
}): Promise<string> {
  const result = await higgsfieldRequest('lipsync-v1', {
    video_url: params.videoUrl,
    audio_url: params.audioUrl,
  });
  return (result.video_url as string) || params.videoUrl;
}
