/** Higgsfield Plus Audio — TTS 모델 (Voiceover UI 기준) */
export const TTS_MODELS = [
  { id: 'eleven-v3', label: 'Eleven v3', emoji: '🎙', sub: '감정 제어 · 표현력 있는 AI 보이스', credits: 14 },
  { id: 'minimax-speech-2.8', label: 'MiniMax Speech 2.8 HD', emoji: '🔊', sub: '스튜디오급 TTS', credits: 12 },
  { id: 'seed-speech', label: 'Seed Speech', emoji: '🌱', sub: 'ByteDance · 다국어 TTS', credits: 10, badge: 'NEW' as const },
  { id: 'vibe-voice', label: 'VibeVoice', emoji: '🎵', sub: '장문 · 표현력 있는 보이스', credits: 12 },
] as const;

export type TtsModelId = (typeof TTS_MODELS)[number]['id'];

export const DEFAULT_TTS_MODEL: TtsModelId = 'eleven-v3';

const LEGACY_TTS: Record<string, TtsModelId> = {
  'minimax-speech': 'minimax-speech-2.8',
  'elevenlabs-v3': 'eleven-v3',
};

export function normalizeTtsModel(raw?: string | null): TtsModelId {
  if (!raw) return DEFAULT_TTS_MODEL;
  const id = LEGACY_TTS[raw] ?? raw;
  if (TTS_MODELS.some((m) => m.id === id)) return id as TtsModelId;
  if (raw.includes('clova')) return DEFAULT_TTS_MODEL;
  return DEFAULT_TTS_MODEL;
}

export function ttsModelLabel(id: string): string {
  const m = TTS_MODELS.find((x) => x.id === id);
  return m ? `${m.emoji} ${m.label}` : 'Eleven v3';
}

function badgePrefix(badge?: 'NEW' | 'TOP'): string {
  return badge ? `[${badge}] ` : '';
}

export function ttsModelOptionLabel(m: (typeof TTS_MODELS)[number]): string {
  const badge = 'badge' in m ? m.badge : undefined;
  return `${m.emoji} ${m.label} — ${badgePrefix(badge)}${m.sub}`;
}
