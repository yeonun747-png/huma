import type { NarrationAxisType } from '@huma/shared';

/** 주제명·소개에서 축(띠/별자리/연령대) 추론 — null이면 순환 pick */
export function inferNarrationAxisFromTopic(text: string): NarrationAxisType | null {
  const src = text.replace(/\s+/g, ' ').trim();
  if (!src) return null;

  let zodiac = 0;
  let constellation = 0;
  let generation = 0;

  if (/별자리|양자리|황소자리|쌍둥이자리|게자리|사자자리|처녀자리|천칭자리|전갈자리|사수자리|염소자리|물병자리|물고기자리/.test(src)) {
    constellation += 5;
  }
  if (/자미두수|14\s*주성|주성|탐랑|천기|문곡|무곡|천상|파군|염정|거문|천동|태음|자미성|별의\s*흐름|별빛|서양\s*점성|황도\s*12/.test(src)) {
    constellation += 4;
  }
  if (/별\s/.test(src) || /별,|별·|별\?|별!|별로/.test(src)) {
    constellation += 1;
  }

  if (/띠별|십이지|12\s*띠|띠\s/.test(src) || /쥐띠|소띠|호랑이띠|토끼띠|용띠|뱀띠|말띠|양띠|원숭이띠|닭띠|개띠|돼지띠/.test(src)) {
    zodiac += 5;
  }
  if (/재수|태어난\s*해|출생\s*년/.test(src)) {
    zodiac += 2;
  }

  if (/연령대|\d0년대\s*생|00\s*세대|세대별|나이대/.test(src)) {
    generation += 5;
  }

  const scores: Array<{ axis: NarrationAxisType; score: number }> = [
    { axis: 'constellation', score: constellation },
    { axis: 'zodiac', score: zodiac },
    { axis: 'generation', score: generation },
  ];
  scores.sort((a, b) => b.score - a.score);

  if (scores[0]!.score <= 0) return null;
  if (scores[0]!.score === scores[1]!.score) return null;
  return scores[0]!.axis;
}

export function topicTextForAxisInference(topic: { label: string; contextText?: string }): string {
  return `${topic.label}\n${topic.contextText ?? ''}`;
}
