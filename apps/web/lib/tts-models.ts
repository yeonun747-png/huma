/** Higgsfield Audio TTS models (ElevenLabs v3 is default). */
export const TTS_MODELS = [
  { id: 'eleven-v3', label: 'ElevenLabs v3', sub: 'Higgsfield · 감정·다국어' },
  { id: 'minimax-speech-2.8', label: 'MiniMax Speech 2.8', sub: 'Higgsfield · HD' },
  { id: 'seed-speech', label: 'Seed Speech', sub: 'Higgsfield' },
  { id: 'vibe-voice', label: 'VibeVoice', sub: 'Higgsfield' },
] as const;

export type TtsModelId = (typeof TTS_MODELS)[number]['id'];

export const DEFAULT_TTS_MODEL: TtsModelId = 'eleven-v3';

export function normalizeTtsModel(raw?: string | null): TtsModelId {
  if (raw && TTS_MODELS.some((m) => m.id === raw)) return raw as TtsModelId;
  if (raw?.includes('clova')) return DEFAULT_TTS_MODEL;
  return DEFAULT_TTS_MODEL;
}

export function ttsModelLabel(id: string): string {
  return TTS_MODELS.find((m) => m.id === id)?.label ?? 'ElevenLabs v3';
}
