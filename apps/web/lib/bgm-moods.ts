export interface BgmMoodCategory {
  id: string;
  label: string;
  titleKo: string;
  hint: string;
}

export const BGM_MOOD_CATEGORIES: BgmMoodCategory[] = [
  { id: 'upbeat', label: 'upbeat', titleKo: '밝고 경쾌', hint: '퀴즈 결과, 긍정적 운세' },
  { id: 'calm', label: 'calm', titleKo: '잔잔하고 평화로운', hint: '명상, 힐링' },
  { id: 'mysterious', label: 'mysterious', titleKo: '신비롭고 몽환적', hint: '사주, 운세' },
  { id: 'emotional', label: 'emotional', titleKo: '감성적·드라마틱', hint: '로맨스, 캐릭터' },
  { id: 'energetic', label: 'energetic', titleKo: '강렬하고 역동적', hint: '임팩트 오프닝' },
  { id: 'cinematic', label: 'cinematic', titleKo: '웅장하고 영화적', hint: '스토리텔링' },
  { id: 'lofi', label: 'lofi', titleKo: '로파이·감성 힙합', hint: '일상, 트렌디' },
];

export function getBgmMoodCategory(mood: string): BgmMoodCategory | undefined {
  return BGM_MOOD_CATEGORIES.find((c) => c.id === mood);
}

export function formatBgmMoodLabel(mood: string): string {
  const cat = getBgmMoodCategory(mood);
  if (!cat) return mood;
  return `${cat.label} · ${cat.titleKo}`;
}

export function formatBgmMoodFull(mood: string): string {
  const cat = getBgmMoodCategory(mood);
  if (!cat) return mood;
  return `${cat.label} · ${cat.titleKo} (${cat.hint})`;
}

export function formatTrackMoods(moods: string[]): string {
  if (moods.length === 0) return '—';
  return moods.map(formatBgmMoodLabel).join(', ');
}
