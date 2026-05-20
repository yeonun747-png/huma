import { higgsfieldRequest } from './client.js';

export type TTSModel = 'eleven-v3' | 'minimax-speech-2.8' | 'seed-speech' | 'vibe-voice';

export async function generateTTS(params: {
  script: string;
  model?: TTSModel;
  voice?: string;
  language?: string;
}): Promise<string> {
  const result = await higgsfieldRequest(params.model || 'eleven-v3', {
    text: params.script,
    voice: params.voice || 'korean_female_calm',
    language: params.language || 'ko',
  });
  return result.audio_url as string;
}
