import { describe, expect, it } from 'vitest';
import {
  actionDescribesOnScreenText,
  dialogueCarriesReadableSetup,
  ensureScreenTextRenderingInConstraints,
  shotNeedsFortuneSetupDialogue,
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

  it('detects framing circumlocution for fax stamp', () => {
    expect(
      actionDescribesOnScreenText(
        'B가 숨기고 있던 문서를 A 앞으로 조심스럽게 내밀며 눈을 살짝 찡그리고 말한다. 문서 상단의 팩스 수신 스탬프가 보이도록 각도를 잡음.',
      ),
    ).toBe(true);
  });

  it('detects angle-to-show readable detail phrasing', () => {
    expect(actionDescribesOnScreenText('확인서 날짜가 선명하게 잡히도록 카메라 각도를 잡는다.')).toBe(true);
  });

  it('allows handing document without readable detail framing', () => {
    expect(
      actionDescribesOnScreenText('B가 종이를 A 앞으로 조심스럽게 내밀며 눈을 살짝 찡그린다.'),
    ).toBe(false);
  });

  it('detects vague "특정 문구" reference in phone scroll action', () => {
    expect(
      actionDescribesOnScreenText(
        'A가 소파에 앉아 스마트폰 화면을 천천히 내려 스크롤하다 특정 문구에서 손가락을 멈추고, 입꼬리를 실룩이며 코웃음을 친 뒤 폰을 내려놓는다.',
      ),
    ).toBe(true);
  });
});

describe('dialogueCarriesReadableSetup', () => {
  it('accepts fortune phrase quoted in dialogue', () => {
    expect(dialogueCarriesReadableSetup('A: "윗집과 소음 갈등 주의라고? 웃기네, 빈 집인데."')).toBe(true);
  });

  it('rejects reaction-only dialogue', () => {
    expect(dialogueCarriesReadableSetup('A: "빈 집인데."')).toBe(false);
  });
});

describe('shotNeedsFortuneSetupDialogue', () => {
  it('detects phone scroll with vague text stop', () => {
    expect(
      shotNeedsFortuneSetupDialogue(
        'A가 스마트폰을 스크롤하다 특정 문구에서 손가락을 멈춘다.',
        '연운 이달 운세에서 윗집과 소음 갈등 주의 문구를 본다.',
      ),
    ).toBe(true);
  });

  it('detects phone scroll from scenarioSummary fortune warning', () => {
    expect(
      shotNeedsFortuneSetupDialogue(
        'A가 소파에 앉아 스마트폰을 스크롤하며 코웃음 친다.',
        '1층 영도가 연운 이달 운세에서 윗집과 소음 갈등 주의 문구를 보고 콧방귀를 뀌었다.',
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

describe('findRawShotQualityIssues fortune_setup_dialogue', () => {
  it('flags yeonun neighbor-noise conti when dialogue omits fortune phrase', () => {
    const conti: VideoConti = {
      characters: [],
      location: '빌라',
      lighting: '형광등',
      timeOfDay: '저녁',
      cutType: 'multi_shot',
      duration: 14,
      scenarioSummary:
        "1층 영도가 연운 이달 운세에서 '윗집과 소음 갈등 주의' 문구를 보고 콧방귀를 뀌었다.",
      fullText: '테스트',
      shots: [
        {
          shotNumber: 1,
          startSec: 0,
          endSec: 2.5,
          camera: '미디엄샷',
          action:
            'A가 소파에 앉아 스마트폰 화면을 천천히 내려 스크롤하다 특정 문구에서 손가락을 멈추고, 입꼬리를 실룩이며 코웃음을 친 뒤 폰을 내려놓는다.',
          dialogue: 'A: "빈 집인데."',
        },
      ],
    };
    const issues = findRawShotQualityIssues(conti);
    expect(issues.some((i) => i.kind === 'on_screen_text' && i.index === 0)).toBe(true);
    expect(issues.some((i) => i.kind === 'fortune_setup_dialogue' && i.index === 0)).toBe(true);
  });

  it('passes when dialogue carries full fortune phrase', () => {
    const conti: VideoConti = {
      characters: [],
      location: '빌라',
      lighting: '형광등',
      timeOfDay: '저녁',
      cutType: 'multi_shot',
      duration: 14,
      scenarioSummary:
        "1층 영도가 연운 이달 운세에서 '윗집과 소음 갈등 주의' 문구를 보고 콧방귀를 뀌었다.",
      fullText: '테스트',
      shots: [
        {
          shotNumber: 1,
          startSec: 0,
          endSec: 2.5,
          camera: '미디엄샷',
          action: 'A가 소파에 앉아 스마트폰을 스크롤하며 코웃음 친 뒤 폰을 내려놓는다.',
          dialogue: 'A: "윗집과 소음 갈등 주의라고? 웃기네, 빈 집인데."',
        },
      ],
    };
    const issues = findRawShotQualityIssues(conti);
    expect(issues.some((i) => i.kind === 'fortune_setup_dialogue')).toBe(false);
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
