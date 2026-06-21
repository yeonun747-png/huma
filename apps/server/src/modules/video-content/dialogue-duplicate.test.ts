import { describe, expect, it } from 'vitest';
import {
  dialoguesTooSimilar,
  findDialogueDuplicateIssue,
  hasDialogueDuplicate,
} from './dialogue-duplicate.js';
import { findRawShotQualityIssues } from './conti-validation.js';
import type { VideoConti } from './types.js';

describe('dialoguesTooSimilar', () => {
  it('treats A/B speaker swap with identical body as duplicate', () => {
    expect(dialoguesTooSimilar('A: "저도 목 일간인데요."', 'B: "저도 목 일간인데요."')).toBe(true);
  });

  it('passes clearly different lines', () => {
    expect(dialoguesTooSimilar('A: "저도 목 일간인데요."', 'B: "로또 당첨 주의?"')).toBe(false);
  });
});

describe('findDialogueDuplicateIssue', () => {
  const baseConti = {
    characters: [],
    location: '편의점',
    lighting: '형광등',
    timeOfDay: '새벽',
    cutType: 'multi_shot' as const,
    duration: 15,
    scenarioSummary: '로또 반전',
    fullText: '테스트',
  };

  it('flags punchline echoing earlier shot dialogue', () => {
    const conti: VideoConti = {
      ...baseConti,
      shots: [
        {
          shotNumber: 1,
          startSec: 0,
          endSec: 2.5,
          camera: '와이드',
          action: 'A가 카운터에 서 있다.',
          dialogue: '',
        },
        {
          shotNumber: 2,
          startSec: 2.5,
          endSec: 5,
          camera: '미디엄',
          action: 'B가 폰을 본다.',
          dialogue: 'B: "목 기운, 진짜네."',
        },
        {
          shotNumber: 3,
          startSec: 5,
          endSec: 7.5,
          camera: '투샷',
          action: 'A가 고개를 든다.',
          dialogue: 'A: "저도 목 일간인데요."',
        },
        {
          shotNumber: 4,
          startSec: 7.5,
          endSec: 10,
          camera: '클로즈업',
          action: 'B가 영수증을 본다.',
          dialogue: 'B: "로또 당첨 주의?"',
        },
        {
          shotNumber: 5,
          startSec: 10,
          endSec: 12.5,
          camera: '미디엄',
          action: 'A가 웃는다.',
          dialogue: 'A: "저는 어젯밤에 샀어요."',
        },
        {
          shotNumber: 6,
          startSec: 12.5,
          endSec: 15,
          camera: '클로즈업',
          action: 'B가 A를 본다.',
          dialogue: 'B: "저도 목 일간인데요."',
        },
      ],
    };

    const issue = findDialogueDuplicateIssue(conti);
    expect(issue).not.toBeNull();
    expect(issue!.index).toBe(5);
    expect(issue!.priorIndex).toBe(2);
    expect(issue!.feedback).toContain('샷 6');
    expect(issue!.feedback).toContain('샷 3');
    expect(hasDialogueDuplicate(conti)).toBe(true);

    const qualityIssues = findRawShotQualityIssues(conti);
    expect(qualityIssues.some((i) => i.kind === 'dialogue_duplicate' && i.index === 5)).toBe(true);
  });

  it('passes when punchline is a distinct reaction', () => {
    const conti: VideoConti = {
      ...baseConti,
      shots: [
        {
          shotNumber: 1,
          startSec: 0,
          endSec: 7,
          camera: '와이드',
          action: 'A가 말한다.',
          dialogue: 'A: "저도 목 일간인데요."',
        },
        {
          shotNumber: 2,
          startSec: 7,
          endSec: 15,
          camera: '투샷',
          action: 'B가 놀란다.',
          dialogue: 'B: "와, 진짜 둘 다 목일간이야?"',
        },
      ],
    };

    expect(findDialogueDuplicateIssue(conti)).toBeNull();
  });
});
