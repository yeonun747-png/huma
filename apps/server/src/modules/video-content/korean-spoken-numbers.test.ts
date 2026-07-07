import { describe, expect, it } from 'vitest';
import { applySpokenKoreanNumbersToConti } from './conti-spoken-numbers.js';
import {
  buildDialogueSpokenNumberRule,
  convertSpokenKoreanNumbers,
  convertSpokenKoreanNumbersToDigits,
  toSinoKoreanNumber,
} from './korean-spoken-numbers.js';

describe('toSinoKoreanNumber', () => {
  it('converts common sino numbers', () => {
    expect(toSinoKoreanNumber(7)).toBe('칠');
    expect(toSinoKoreanNumber(12)).toBe('십이');
    expect(toSinoKoreanNumber(48)).toBe('사십팔');
    expect(toSinoKoreanNumber(5000)).toBe('오천');
    expect(toSinoKoreanNumber(2026)).toBe('이천이십육');
  });
});

describe('convertSpokenKoreanNumbers', () => {
  it('converts month, count, and hour examples', () => {
    expect(convertSpokenKoreanNumbers('7월에 만나요')).toBe('칠월에 만나요');
    expect(convertSpokenKoreanNumbers('7개 남았어')).toBe('일곱개 남았어');
    expect(convertSpokenKoreanNumbers('12시까지')).toBe('열두시까지');
  });

  it('converts waiting numbers and money', () => {
    expect(convertSpokenKoreanNumbers('48번이요')).toBe('사십팔번이요');
    expect(convertSpokenKoreanNumbers('5000원이요')).toBe('오천원이요');
  });

  it('converts clock times', () => {
    expect(convertSpokenKoreanNumbers('7:30까지')).toBe('일곱시 삼십분까지');
  });

  it('preserves speaker labels', () => {
    expect(convertSpokenKoreanNumbers('A: "7개 남았어"')).toBe('A: "일곱개 남았어"');
  });

  it('leaves text without digits unchanged', () => {
    expect(convertSpokenKoreanNumbers('안녕하세요')).toBe('안녕하세요');
  });
});

describe('convertSpokenKoreanNumbersToDigits', () => {
  it('restores month, count, and hour examples', () => {
    expect(convertSpokenKoreanNumbersToDigits('칠월에 만나요')).toBe('7월에 만나요');
    expect(convertSpokenKoreanNumbersToDigits('일곱개 남았어')).toBe('7개 남았어');
    expect(convertSpokenKoreanNumbersToDigits('열두시까지')).toBe('12시까지');
  });

  it('restores waiting numbers, money, and clock times', () => {
    expect(convertSpokenKoreanNumbersToDigits('사십팔번이요')).toBe('48번이요');
    expect(convertSpokenKoreanNumbersToDigits('오천원이요')).toBe('5000원이요');
    expect(convertSpokenKoreanNumbersToDigits('일곱시 삼십분까지')).toBe('7:30까지');
  });

  it('round-trips common dialogue numbers', () => {
    const src = '7월 7개 12시 48번 5000원';
    expect(convertSpokenKoreanNumbersToDigits(convertSpokenKoreanNumbers(src))).toBe(
      '7월 7개 12시 48번 5000원',
    );
  });
});

describe('applySpokenKoreanNumbersToConti', () => {
  it('updates shot dialogue only', () => {
    const next = applySpokenKoreanNumbersToConti({
      characters: [],
      location: '',
      lighting: '',
      timeOfDay: '',
      cutType: 'single_shot',
      duration: 15,
      scenarioSummary: '',
      fullText: '',
      shots: [
        {
          shotNumber: 1,
          startSec: 0,
          endSec: 15,
          camera: '미디엄',
          action: '번호표 48번을 본다',
          dialogue: 'A: "48번이요?"',
        },
      ],
    });
    expect(next.shots[0]?.dialogue).toBe('A: "사십팔번이요?"');
    expect(next.shots[0]?.action).toBe('번호표 48번을 본다');
  });
});

describe('buildDialogueSpokenNumberRule', () => {
  it('mentions key examples', () => {
    expect(buildDialogueSpokenNumberRule()).toMatch(/7월→칠월/);
    expect(buildDialogueSpokenNumberRule()).toMatch(/7개→일곱개/);
    expect(buildDialogueSpokenNumberRule()).toMatch(/12시→열두시/);
  });
});
