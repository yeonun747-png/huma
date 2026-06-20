import { describe, expect, it } from 'vitest';
import {
  countDialogueQuotedChars,
  dialogueCharsPerSec,
  findDialogueTooLongIssue,
  isDialogueTooLongForShot,
  maxDialogueCharsForDuration,
  minShotDurationForDialogue,
} from './dialogue-timing.js';
import { findRawShotQualityIssues } from './conti-validation.js';
import type { VideoConti, VideoContiShot } from './types.js';

describe('countDialogueQuotedChars', () => {
  it('counts only quoted dialogue body', () => {
    expect(countDialogueQuotedChars('A: "오늘 관운 막혔대."')).toBe(8);
  });

  it('handles inner single quotes inside double quotes', () => {
    expect(countDialogueQuotedChars(`B: "이름은 '관운'이야."`)).toBe(10);
  });
});

describe('isDialogueTooLongForShot', () => {
  const shot = (dialogue: string, startSec: number, endSec: number): VideoContiShot => ({
    shotNumber: 1,
    startSec,
    endSec,
    camera: '미디엄',
    action: 'B가 말한다.',
    dialogue,
  });

  it('flags when chars per second exceeds 5', () => {
    const dialogue = 'A: "' + '가'.repeat(16) + '"';
    expect(isDialogueTooLongForShot(shot(dialogue, 0, 2.5))).toBe(true);
    expect(dialogueCharsPerSec(dialogue, 2.5)).toBeCloseTo(6.4, 1);
  });

  it('passes at exactly 5 chars per second boundary', () => {
    const dialogue = 'A: "' + '가'.repeat(12) + '"';
    expect(isDialogueTooLongForShot(shot(dialogue, 0, 2.5))).toBe(false);
    expect(maxDialogueCharsForDuration(2.5)).toBe(12);
  });

  it('passes when 13 chars would exceed 5 per sec on 2.5s shot', () => {
    const dialogue = 'A: "' + '가'.repeat(13) + '"';
    expect(isDialogueTooLongForShot(shot(dialogue, 0, 2.5))).toBe(true);
  });
});

describe('minShotDurationForDialogue', () => {
  it('rounds up to 0.5s steps for long punchline', () => {
    expect(minShotDurationForDialogue(`B: "${'가'.repeat(18)}"`, 2)).toBe(4);
  });
});

describe('findRawShotQualityIssues dialogue_too_long', () => {
  it('flags dialogue too long for shot duration', () => {
    const conti: VideoConti = {
      characters: [],
      location: '공원',
      lighting: '자연광',
      timeOfDay: '오후',
      cutType: 'multi_shot',
      duration: 12,
      scenarioSummary: '테스트',
      fullText: '테스트',
      shots: [
        {
          shotNumber: 1,
          startSec: 0,
          endSec: 2.5,
          camera: '와이드',
          action: 'A가 스마트폰을 본다.',
          dialogue: 'A: "나 오늘 네 사주 봤는데, 오늘 관운이 완전히 막혀 있대."',
        },
      ],
    };

    const issues = findRawShotQualityIssues(conti);
    expect(issues.some((i) => i.kind === 'dialogue_too_long')).toBe(true);
  });

  it('findDialogueTooLongIssue returns structured feedback', () => {
    const issue = findDialogueTooLongIssue(
      {
        shotNumber: 5,
        startSec: 9.5,
        endSec: 12,
        camera: '투샷',
        action: 'B가 말한다.',
        dialogue: `B: "이름은 '관운'이야. 잘 어울리지 않아?"`,
      },
      4,
    );
    expect(issue?.kind).toBe('dialogue_too_long');
    expect(issue?.feedback).toContain('샷 5');
    expect(issue?.feedback).toContain('2.5초');
  });
});
