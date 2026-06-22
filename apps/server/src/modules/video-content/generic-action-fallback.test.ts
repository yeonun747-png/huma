import { describe, expect, it } from 'vitest';
import {
  applyGenericActionNarrativeFallback,
  synthesizeConcreteShotAction,
} from './generic-action-fallback.js';
import { isGenericDefaultAction } from './conti-validation.js';
import type { VideoConti } from './types.js';

describe('synthesizeConcreteShotAction', () => {
  const prose =
    'A가 스마트폰 알림을 확인한다. B가 카드 명세서를 펼치며 입을 틀어막는다. A가 통장 잔액을 보며 말한다.';

  it('derives concrete action from narrative prose', () => {
    const action = synthesizeConcreteShotAction({
      shotIndex: 1,
      shotCount: 4,
      narrativeProse: prose,
    });
    expect(isGenericDefaultAction(action)).toBe(false);
    expect(action.length).toBeGreaterThan(10);
  });

  it('replaces filler actions in conti', () => {
    const conti: VideoConti = {
      characters: [],
      location: '집',
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
          dialogue: 'A: "통장에 구멍?"',
        },
        {
          shotNumber: 4,
          startSec: 9,
          endSec: 12,
          camera: '클로즈',
          action: '장면이 서서히 멀어지며 여운 있게 마무리된다.',
          dialogue: '',
        },
      ],
    };
    const { conti: fixed, replacedShotNumbers } = applyGenericActionNarrativeFallback(conti, {
      storyDraft: { narrativeProse: prose } as never,
    });
    expect(replacedShotNumbers).toEqual([1, 4]);
    expect(isGenericDefaultAction(fixed.shots[0]!.action)).toBe(false);
    expect(isGenericDefaultAction(fixed.shots[1]!.action)).toBe(false);
  });
});
