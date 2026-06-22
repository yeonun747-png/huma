import { describe, expect, it } from 'vitest';
import {
  GENERIC_DEFAULT_ACTION_PHRASES,
  buildGenericActionFeedback,
  buildGenericActionBatchFeedback,
  findRawShotQualityIssues,
  isGenericDefaultAction,
} from './conti-validation.js';
import type { VideoConti } from './types.js';

describe('isGenericDefaultAction', () => {
  it('detects evolink default filler phrases', () => {
    for (const phrase of GENERIC_DEFAULT_ACTION_PHRASES) {
      expect(isGenericDefaultAction(phrase)).toBe(true);
      expect(isGenericDefaultAction(`${phrase}.`)).toBe(true);
    }
  });

  it('allows concrete action', () => {
    expect(
      isGenericDefaultAction('A가 스마트폰 알림을 확인하며 입을 틀어막고 카드 명세서를 펼친다.'),
    ).toBe(false);
  });
});

describe('findRawShotQualityIssues generic_action', () => {
  it('flags filler action with specific feedback', () => {
    const conti: VideoConti = {
      characters: [],
      location: '카페',
      lighting: '밝음',
      timeOfDay: '낮',
      cutType: 'multi_shot',
      duration: 12,
      scenarioSummary: '테스트',
      fullText: '테스트',
      shots: [
        {
          shotNumber: 1,
          startSec: 0,
          endSec: 3,
          camera: '와이드',
          action: '행동과 반응이 이어지며 장면이 전개된다.',
          dialogue: 'A: "통장에 구멍이라고 웃기네요."',
        },
      ],
    };
    const issues = findRawShotQualityIssues(conti);
    expect(issues.some((i) => i.kind === 'generic_action')).toBe(true);
    expect(buildGenericActionFeedback(1)).toContain('filler');
  });

  it('builds batch feedback for multiple shots', () => {
    const msg = buildGenericActionBatchFeedback([1, 2, 5]);
    expect(msg).toContain('샷 1, 2, 5');
    expect(msg).toContain('filler');
  });

  it('includes narrative prose in batch feedback', () => {
    const msg = buildGenericActionBatchFeedback([2, 3], 'A가 폰을 본다.');
    expect(msg).toContain('A가 폰을 본다.');
  });
});
