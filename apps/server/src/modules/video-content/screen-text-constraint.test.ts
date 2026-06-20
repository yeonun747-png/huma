import { describe, expect, it } from 'vitest';
import {
  actionDescribesOnScreenText,
  ensureScreenTextRenderingInConstraints,
} from './screen-text-constraint.js';
import { findRawShotQualityIssues } from './conti-validation.js';
import type { VideoConti } from './types.js';

describe('actionDescribesOnScreenText', () => {
  it('detects explicit on-screen letter rendering', () => {
    expect(
      actionDescribesOnScreenText(
        "B가 종이를 받아 들고 읽기 시작하다가 표정이 굳어버린다. '우수 수강생 장학금 수여 확인서' 글자가 화면에 선명하게 잡힌다.",
      ),
    ).toBe(true);
  });

  it('detects quoted text applied to document surface', () => {
    expect(actionDescribesOnScreenText('문서에 "낙제"라고 적혀 있다.')).toBe(true);
  });

  it('allows document prop without specific readable text', () => {
    expect(actionDescribesOnScreenText('B가 종이를 받아 들고 표정이 굳어진다.')).toBe(false);
  });

  it('allows smartphone without on-screen text rendering', () => {
    expect(actionDescribesOnScreenText('A가 스마트폰을 꺼내 연운 앱을 연다.')).toBe(false);
  });
});

describe('ensureScreenTextRenderingInConstraints', () => {
  it('appends rule once when missing', () => {
    const out = ensureScreenTextRenderingInConstraints('연운 제약:\n- 테스트');
    expect(out).toContain('화면 속 텍스트');
    expect(out.split('화면 속 텍스트').length).toBe(2);
  });

  it('does not duplicate when already present', () => {
    const base = ensureScreenTextRenderingInConstraints('연운');
    const out = ensureScreenTextRenderingInConstraints(base);
    expect(out).toBe(base);
  });
});

describe('findRawShotQualityIssues on_screen_text', () => {
  it('flags shot with on-screen text in action', () => {
    const conti: VideoConti = {
      characters: [],
      location: '시장',
      lighting: '따뜻',
      timeOfDay: '오후',
      cutType: 'multi_shot',
      duration: 15,
      scenarioSummary: '테스트',
      fullText: '테스트',
      shots: [
        {
          shotNumber: 1,
          startSec: 0,
          endSec: 5,
          camera: '클로즈업',
          action: "확인서 글자가 선명하게 잡힌다.",
          dialogue: 'A: "이게 뭐지?"',
        },
      ],
    };
    const issues = findRawShotQualityIssues(conti);
    expect(issues.some((i) => i.kind === 'on_screen_text')).toBe(true);
  });
});
