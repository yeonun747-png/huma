/** A~Z 화자 자막 색 — 6색 순환 (ASS PrimaryColour &H00BBGGRR) */
export const SPEAKER_ASS_COLORS = [
  '&H0000FFFF', // A 노란색
  '&H00FFFFFF', // B 흰색
  '&H00FF9000', // C 파란색
  '&H00008CFF', // D 주황색
  '&H0000DD50', // E 초록색
  '&H00DD50FF', // F 보라색
] as const;

/** 웹 미리보기 Tailwind 클래스 — SPEAKER_ASS_COLORS와 동일 순서 */
export const SPEAKER_PREVIEW_CLASSES = [
  'text-yellow-300',
  'text-white',
  'text-blue-400',
  'text-orange-400',
  'text-green-400',
  'text-purple-400',
] as const;

const DEFAULT_ASS_COLOR = '&H00FFFFFF';

export function normalizeSpeakerLabel(speaker: string | null | undefined): string | null {
  if (!speaker) return null;
  const letter = speaker.trim().toUpperCase();
  if (!/^[A-Z]$/.test(letter)) return null;
  return letter;
}

export function speakerColorIndex(speaker: string | null | undefined): number {
  const letter = normalizeSpeakerLabel(speaker);
  if (!letter) return 1;
  return (letter.charCodeAt(0) - 'A'.charCodeAt(0)) % SPEAKER_ASS_COLORS.length;
}

export function speakerAssColor(speaker: string | null | undefined): string {
  const letter = normalizeSpeakerLabel(speaker);
  if (!letter) return DEFAULT_ASS_COLOR;
  return SPEAKER_ASS_COLORS[speakerColorIndex(letter)]!;
}

export function speakerPreviewClass(speaker: string | null | undefined): string {
  const letter = normalizeSpeakerLabel(speaker);
  if (!letter) return 'text-white';
  return SPEAKER_PREVIEW_CLASSES[speakerColorIndex(letter)]!;
}
