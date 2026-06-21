import { describe, expect, it } from 'vitest';
import { contiToStoryDraft, parseStoryDraft } from './story-draft.js';
import type { VideoConti } from './types.js';

describe('parseStoryDraft', () => {
  it('parses narrativeProse and falls back to narrative/story keys', () => {
    const fromProse = parseStoryDraft({
      narrativeProse: 'A와 B가 카페에서 대화한다.',
      location: '카페',
      characters: [],
    });
    expect(fromProse.narrativeProse).toBe('A와 B가 카페에서 대화한다.');

    const fromNarrative = parseStoryDraft({ narrative: '대체 키 서술' });
    expect(fromNarrative.narrativeProse).toBe('대체 키 서술');
  });

  it('throws when narrative is empty', () => {
    expect(() => parseStoryDraft({ location: '카페' })).toThrow(/narrativeProse/);
  });
});

describe('contiToStoryDraft', () => {
  it('prefers embedded storyDraft', () => {
    const draft = {
      narrativeProse: '저장된 3a',
      locationKeyword: '카페',
      timeOfDay: '오후',
      characters: [],
      location: '카페',
      lighting: '따뜻',
      timeOfDayVisual: '오후',
      scenarioSummary: '요약',
    };
    const conti = { storyDraft: draft } as VideoConti & { storyDraft: typeof draft };
    expect(contiToStoryDraft(conti)).toEqual(draft);
  });

  it('reconstructs from legacy conti fields', () => {
    const conti: VideoConti = {
      characters: [{ label: 'A', name: '민수', age: '20대', gender: '남', hair: '짧음', outfit: '캐주얼', shoes: '운동화' }],
      location: '공원',
      lighting: '자연광',
      timeOfDay: '아침',
      cutType: 'multi_shot',
      duration: 15,
      scenarioSummary: '공원 산책',
      fullText: '공원에서 산책하며 대화',
      shots: [],
    };
    const draft = contiToStoryDraft(conti);
    expect(draft.narrativeProse).toBe('공원에서 산책하며 대화');
    expect(draft.location).toBe('공원');
  });
});
