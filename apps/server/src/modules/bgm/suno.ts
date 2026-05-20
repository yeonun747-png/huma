import axios from 'axios';

export async function generateSunoMusic(params: {
  workspace: string;
  contentMood: string;
  videoDurationSec: number;
  platform: string;
}): Promise<string> {
  const apiKey = process.env.SUNO_API_KEY;
  if (!apiKey) {
    throw new Error('Suno API 키 없음 — BGM 라이브러리에 음원을 등록하세요');
  }

  const prompt = `${params.contentMood} ambient background music for ${params.workspace}, ${params.videoDurationSec}s, suitable for ${params.platform}`;

  const { data } = await axios.post(
    'https://api.suno.ai/v1/generate',
    { prompt, duration: params.videoDurationSec },
    { headers: { Authorization: `Bearer ${apiKey}` } }
  );

  return data.audio_url as string;
}
