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

  it('detects name sticker on slipper sole', () => {
    expect(
      actionDescribesOnScreenText(
        'B가 신고 있는 슬리퍼 바닥에 다른 알바생 이름이 적힌 스티커가 선명하게 붙어 있는 것이 화면에 잡힌다.',
      ),
    ).toBe(true);
  });

  it('detects readable name badge in action', () => {
    expect(actionDescribesOnScreenText('가슴 명찰에 파트장이라고 적혀 보인다.')).toBe(true);
  });

  it('detects yeonun app result page with name on screen', () => {
    expect(
      actionDescribesOnScreenText(
        '스마트폰 화면에 앱이 켜진 채 B 이름이 적힌 사주 결과 페이지가 노출된다.',
      ),
    ).toBe(true);
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

describe('findRawShotQualityIssues punchline_clarity', () => {
  const baseConti = {
    characters: [],
    location: '편의점',
    lighting: '형광등',
    timeOfDay: '새벽',
    cutType: 'multi_shot' as const,
    duration: 11,
    scenarioSummary: '슬리퍼 반전',
    fullText: '테스트',
  };

  it('flags silent punchline after readable visual setup', () => {
    const conti: VideoConti = {
      ...baseConti,
      shots: [
        {
          shotNumber: 1,
          startSec: 0,
          endSec: 4,
          camera: '와이드',
          action: 'A와 B가 카운터에 서 있다.',
          dialogue: 'A: "선배, 오늘 목기운 강했어요."',
        },
        {
          shotNumber: 2,
          startSec: 4,
          endSec: 6,
          camera: '미디엄',
          action: 'B가 고개를 돌리지 않는다.',
          dialogue: 'B: "…그래서."',
        },
        {
          shotNumber: 3,
          startSec: 6,
          endSec: 8,
          camera: '로우앵글',
          action:
            'B가 신고 있는 슬리퍼 바닥에 다른 알바생 이름이 적힌 스티커가 선명하게 붙어 있는 것이 화면에 잡힌다.',
          dialogue: '',
        },
        {
          shotNumber: 4,
          startSec: 8,
          endSec: 11,
          camera: '투샷',
          action: 'A와 B가 동시에 슬리퍼를 내려다보고, A는 입을 벌린 채 굳고 B는 눈을 천천히 깜빡인다.',
          dialogue: '',
        },
      ],
    };

    const issues = findRawShotQualityIssues(conti);
    expect(issues.some((i) => i.kind === 'on_screen_text' && i.index === 2)).toBe(true);
    expect(issues.some((i) => i.kind === 'punchline_clarity' && i.index === 3)).toBe(true);
  });

  it('passes when last shot dialogue explains the twist', () => {
    const conti: VideoConti = {
      ...baseConti,
      shots: [
        {
          shotNumber: 1,
          startSec: 0,
          endSec: 5,
          camera: '와이드',
          action: 'A와 B가 슬리퍼를 내려다본다.',
          dialogue: '',
        },
        {
          shotNumber: 2,
          startSec: 5,
          endSec: 11,
          camera: '투샷',
          action: 'A가 놀란 표정으로 B를 본다.',
          dialogue: 'A: "어? 이 슬리퍼 내 거 아닌데, 민지 거잖아."',
        },
      ],
    };

    const issues = findRawShotQualityIssues(conti);
    expect(issues.some((i) => i.kind === 'punchline_clarity')).toBe(false);
  });
});
