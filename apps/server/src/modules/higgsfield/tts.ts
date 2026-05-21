import { higgsfieldRequest } from './client.js';
import { resolveTtsApiModel } from './model-map.js';

export type TTSModel = 'eleven-v3' | 'minimax-speech-2.8' | 'seed-speech' | 'vibe-voice';

export async function generateTTS(params: {
  script: string;
  model?: TTSModel | string;
  voice?: string;
  language?: string;
}): Promise<string> {
  const uiModel = params.model || 'eleven-v3';
  const model = resolveTtsApiModel(uiModel);
  const result = await higgsfieldRequest(model, {
    text: params.script,
    voice: params.voice || 'korean_female_calm',
    language: params.language || 'ko',
  });
  return result.audio_url as string;
}
