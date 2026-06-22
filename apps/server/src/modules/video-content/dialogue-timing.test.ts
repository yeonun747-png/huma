import { describe, expect, it } from 'vitest';
import {
  countDialogueQuotedChars,
  dialogueCharsPerSec,
  DIALOGUE_TRIM_CHARS_PER_SEC,
  enforceDialogueOnConti,
  findDialogueTooLongIssue,
  isDialogueTooLongForShot,
  maxDialogueCharsForDuration,
  maxDialogueTrimCharsForDuration,
  mergeShotTimingKeepDialogue,
  minShotDurationForDialogue,
  trimDialogueToFitShot,
  buildPerShotDialogueBudgetGuide,
  contiNeedsDialogueBudgetFit,
  totalDialogueSpokenChars,
} from './dialogue-timing.js';
import { findRawShotQualityIssues, enforceDialogueShotsMinDuration } from './conti-validation.js';
import type { VideoConti, VideoContiShot } from './types.js';

describe('countDialogueQuotedChars', () => {
  it('counts only quoted dialogue body', () => {
    expect(countDialogueQuotedChars('A: "오늘 관운 막혔대."')).toBe(8);
  });

  it('handles inner single quotes inside double quotes', () => {
    expect(countDialogueQuotedChars(`B: "이름은 '관운'이야."`)).toBe(10);
  });

  it('sums multiple A/B lines in one shot', () => {
    const dialogue =
      'A: "저기요, 그거 혹시…" B: "연운에서 오늘 도움운 좋다고 했거든요. 이 책은 사도 괜찮아요." A: "저 사람… 나 대신 산 건가."';
    expect(countDialogueQuotedChars(dialogue)).toBeGreaterThan(40);
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

  it('flags when chars per second exceeds 8', () => {
    const dialogue = 'A: "' + '가'.repeat(21) + '"';
    expect(isDialogueTooLongForShot(shot(dialogue, 0, 2.5))).toBe(true);
    expect(dialogueCharsPerSec(dialogue, 2.5)).toBeCloseTo(8.4, 1);
  });

  it('passes at 8 chars per second boundary', () => {
    const dialogue = 'A: "' + '가'.repeat(20) + '"';
    expect(isDialogueTooLongForShot(shot(dialogue, 0, 2.5))).toBe(false);
    expect(maxDialogueCharsForDuration(2.5)).toBe(20);
  });

  it('passes narrative setup on 1.5s shot', () => {
    const dialogue = 'A: "새 상품들 창고에 넣어줘."';
    expect(isDialogueTooLongForShot(shot(dialogue, 0, 1.5))).toBe(false);
  });
});

describe('minShotDurationForDialogue', () => {
  it('rounds up to 0.5s steps for long punchline', () => {
    expect(minShotDurationForDialogue(`B: "${'가'.repeat(18)}"`, 2)).toBe(2.5);
  });
});

describe('trimDialogueToFitShot', () => {
  it('compresses severely overflowing dialogue', () => {
    const long = `A: "${'가'.repeat(55)}"`;
    const trimmed = trimDialogueToFitShot(long, 4);
    const max = maxDialogueTrimCharsForDuration(4);
    expect(trimmed.length).toBeLessThan(long.length);
    expect(countDialogueQuotedChars(trimmed)).toBeLessThanOrEqual(max);
  });

  it('prefers complete sentences over mid-word ellipsis', () => {
    const text = '연운에서 오늘 도움운 좋다고 했거든요. 이 책은 사도 괜찮아요.';
    const trimmed = trimDialogueToFitShot(`B: "${text}"`, 2, DIALOGUE_TRIM_CHARS_PER_SEC);
    expect(trimmed).toContain('연운에서');
    expect(trimmed).not.toMatch(/좋다고\s*…$/);
  });
});

describe('mergeShotTimingKeepDialogue', () => {
  it('keeps reviewed action and dialogue when shot timing is extended', () => {
    const original: VideoConti = {
      characters: [],
      location: '편의점',
      lighting: '밝음',
      timeOfDay: '낮',
      cutType: 'multi_shot',
      duration: 11,
      scenarioSummary: '테스트',
      fullText: '테스트',
      shots: [
        {
          shotNumber: 2,
          startSec: 1.5,
          endSec: 3,
          camera: '클로즈업',
          action: 'B가 스마트폰 화면을 보며 조심스럽게 연운 관재궁 경고를 읽는다.',
          dialogue: 'B: "어… 사장님, 연운 관재궁 물품 손상 주의래요."',
        },
      ],
    };
    const timed: VideoConti = {
      ...original,
      shots: [{ ...original.shots[0]!, startSec: 1.5, endSec: 4 }],
    };
    const merged = mergeShotTimingKeepDialogue(timed, original);
    expect(merged.shots[0]!.endSec).toBe(4);
    expect(merged.shots[0]!.action).toBe(original.shots[0]!.action);
    expect(merged.shots[0]!.dialogue).toBe(original.shots[0]!.dialogue);
  });
});

describe('enforceDialogueOnConti', () => {
  it('leaves yeonun convenience-store setup dialogue intact', () => {
    const conti: VideoConti = {
      characters: [],
      location: '편의점',
      lighting: '형광등',
      timeOfDay: '한낮',
      cutType: 'multi_shot',
      duration: 11,
      scenarioSummary: '편의점 펀치',
      fullText: '편의점',
      shots: [
        {
          shotNumber: 1,
          startSec: 0,
          endSec: 1.5,
          camera: '미디엄',
          action: 'A가 손짓한다.',
          dialogue: 'A: "새 상품들 창고에 넣어줘."',
        },
        {
          shotNumber: 2,
          startSec: 1.5,
          endSec: 3,
          camera: '클로즈업',
          action: 'B가 폰을 본다.',
          dialogue: 'B: "어… 사장님, 연운 관재궁 물품 손상 주의래요."',
        },
        {
          shotNumber: 4,
          startSec: 3,
          endSec: 6,
          camera: '클로즈업',
          action: '진열대 선반이 무너진다.',
          dialogue: '',
        },
        {
          shotNumber: 5,
          startSec: 6,
          endSec: 11,
          camera: '와이드',
          action: 'A가 얼굴을 감싼다.',
          dialogue: 'A: "아 진짜… 관재궁이 이거였구나. 다음엔 그냥 믿을게."',
        },
      ],
    };
    const { conti: fixed, adjusted } = enforceDialogueOnConti(
      enforceDialogueShotsMinDuration(conti).conti,
    );
    expect(adjusted).toBe(false);
    expect(fixed.shots[0]!.dialogue).toContain('창고');
    expect(fixed.shots[1]!.dialogue).toContain('관재궁');
  });

  it('shortens only severely overflowing punchline shot', () => {
    const conti: VideoConti = {
      characters: [],
      location: '서점',
      lighting: '따뜻한 조명',
      timeOfDay: '오후',
      cutType: 'multi_shot',
      duration: 12,
      scenarioSummary: '서점 펀치',
      fullText: '서점',
      shots: [
        {
          shotNumber: 4,
          startSec: 4.5,
          endSec: 8,
          camera: '미디엄',
          action: '계산대로 걸어간다.',
          dialogue: `A: "${'가'.repeat(50)}"`,
        },
      ],
    };
    const { conti: fixed, adjusted } = enforceDialogueOnConti(conti);
    expect(adjusted).toBe(true);
    const dialogue = fixed.shots[0]!.dialogue ?? '';
    expect(countDialogueQuotedChars(dialogue)).toBeLessThanOrEqual(maxDialogueTrimCharsForDuration(3.5));
  });
});

describe('per-shot dialogue budget', () => {
  it('buildPerShotDialogueBudgetGuide lists shot durations and char caps', () => {
    const guide = buildPerShotDialogueBudgetGuide(14, 5);
    expect(guide).toContain('14초');
    expect(guide).toContain('112자');
    expect(guide).toContain('8자/초');
    expect(guide).toContain('샷1');
    expect(guide).toContain('최대 12자');
  });

  it('detects yeonun-style over-budget conti', () => {
    const conti: VideoConti = {
      characters: [],
      location: '회의실',
      lighting: '밝음',
      timeOfDay: '낮',
      cutType: 'multi_shot',
      duration: 14,
      scenarioSummary: '테스트',
      fullText: '테스트',
      shots: [
        { shotNumber: 1, startSec: 0, endSec: 1.5, camera: '미디엄', action: 'A가 폰을 본다.', dialogue: 'A: "오늘 연운 앱에서 커리어 사주 봤는데요. 협력자와의 신뢰 문제 주의라고 했어요."' },
        { shotNumber: 2, startSec: 1.5, endSec: 4, camera: '클로즈', action: 'A가 말한다.', dialogue: 'A: "구두 약속만 남으면 모래 위의 집처럼 무너질 수 있다고 해서요. 그래서 오늘 논의한 거 전부 문서로 남기고 싶은데, 체크리스트 같은 거 함께 만들어도 될까요?"' },
      ],
    };
    expect(totalDialogueSpokenChars(conti)).toBeGreaterThan(112);
    expect(contiNeedsDialogueBudgetFit(conti)).toBe(true);
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
        dialogue: `B: "이름은 '관운'이야. 잘 어울리지 않아? 진짜 말도 안 되게 딱 맞는데."`,
      },
      4,
    );
    expect(issue?.kind).toBe('dialogue_too_long');
    expect(issue?.feedback).toContain('샷 5');
    expect(issue?.feedback).toContain('2.5초');
  });
});
