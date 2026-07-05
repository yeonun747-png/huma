import { describe, expect, it } from 'vitest';
import { formatEvoLinkCharacterBlock } from './character-labels.js';
import { resolveCharacterFaceDescription } from './character-appearance.js';
import type { VideoConti } from './types.js';

describe('resolveCharacterFaceDescription', () => {
  it('uses explicit face when provided', () => {
    expect(
      resolveCharacterFaceDescription({
        label: 'A',
        age: '20대',
        gender: '여',
        face: '연예인급 훈녀, 작은 얼굴',
        hair: '긴 생머리',
        outfit: '니트',
        shoes: '로퍼',
      }),
    ).toBe('연예인급 훈녀, 작은 얼굴');
  });

  it('falls back to gender-based attractive face', () => {
    expect(
      resolveCharacterFaceDescription({
        label: 'B',
        age: '30대',
        gender: '남',
        hair: '짧은 머리',
        outfit: '셔츠',
        shoes: '운동화',
      }),
    ).toContain('훈남');
  });
});

describe('formatEvoLinkCharacterBlock', () => {
  it('includes face description in EvoLink character block', () => {
    const conti: VideoConti = {
      characters: [
        {
          label: 'A',
          name: '하은',
          age: '20대',
          gender: '여',
          face: '연예인급 훈녀, 큰 눈',
          hair: '웨이브',
          outfit: '코트',
          shoes: '부츠',
        },
      ],
      location: '카페',
      lighting: '따뜻',
      timeOfDay: '오후',
      cutType: 'multi_shot',
      duration: 11,
      shots: [],
      scenarioSummary: '테스트',
      fullText: '',
    };
    const block = formatEvoLinkCharacterBlock(conti, new Map([['하은', 'A']]));
    expect(block).toContain('연예인급 훈녀');
    expect(block).toContain('A(하은)');
  });
});
