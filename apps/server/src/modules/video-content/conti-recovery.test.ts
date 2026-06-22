import { describe, expect, it } from 'vitest';
import { applyRuleBasedShotRecovery, fixAdjacentDuplicateShots } from './conti-recovery.js';
import { isGenericDefaultAction } from './conti-validation.js';
import type { VideoConti } from './types.js';

const prose =
  'A가 스마트폰 알림을 확인한다. B가 카드 명세서를 펼치며 입을 틀어막는다. A가 통장 잔액을 보며 말한다.';

describe('fixAdjacentDuplicateShots', () => {
  it('differentiates adjacent duplicate actions without LLM', () => {
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
          endSec: 6,
          camera: '와이드',
          action: 'A가 카운터 앞에서 주문한다.',
          dialogue: 'A: "아메리카노요."',
        },
        {
          shotNumber: 2,
          startSec: 6,
          endSec: 12,
          camera: '와이드',
          action: 'A가 카운터 앞에서 주문한다.',
          dialogue: 'A: "아메리카노요."',
        },
      ],
    };
    const fixed = fixAdjacentDuplicateShots(conti);
    expect(fixed.shots[1]!.action).not.toBe(conti.shots[1]!.action);
  });
});

describe('applyRuleBasedShotRecovery', () => {
  it('replaces filler actions from narrative', () => {
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
          endSec: 12,
          camera: '와이드',
          action: '행동과 반응이 이어지며 장면이 전개된다.',
          dialogue: 'A: "통장에 구멍?"',
        },
      ],
    };
    const { conti: fixed, warnings } = applyRuleBasedShotRecovery({
      conti,
      storyDraft: { narrativeProse: prose } as never,
    });
    expect(isGenericDefaultAction(fixed.shots[0]!.action)).toBe(false);
    expect(warnings.length).toBeGreaterThan(0);
  });
});
