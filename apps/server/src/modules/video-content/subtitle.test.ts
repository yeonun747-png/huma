import { describe, expect, it } from 'vitest';
import type { SubtitleStyle, VideoConti } from './types.js';
import {
  buildAssContent,
  buildSubtitlePreviewEvents,
  buildTimedDialogueCues,
  formatAssDialogueText,
  parseDialogueSegments,
  stripSpeakerLabel,
} from './subtitle.js';

describe('parseDialogueSegments', () => {
  it('parses single speaker with label', () => {
    expect(parseDialogueSegments('A: "안녕"')).toEqual([{ speaker: 'A', text: '안녕' }]);
  });

  it('parses multiple speakers in one line', () => {
    expect(parseDialogueSegments('B: "지퍼 확인해." A: "제발."')).toEqual([
      { speaker: 'B', text: '지퍼 확인해.' },
      { speaker: 'A', text: '제발.' },
    ]);
  });

  it('parses without quotes', () => {
    expect(parseDialogueSegments('B: 지퍼 확인해')).toEqual([{ speaker: 'B', text: '지퍼 확인해' }]);
  });
});

describe('stripSpeakerLabel', () => {
  it('removes all speaker labels', () => {
    expect(stripSpeakerLabel('B: "지퍼 확인해." A: "제발."')).toBe('지퍼 확인해. 제발.');
  });

  it('removes leading label only once before fix regression', () => {
    expect(stripSpeakerLabel('A: "한마디"')).toBe('한마디');
  });
});

describe('formatAssDialogueText', () => {
  it('uses SpeakerB style for single B line', () => {
    expect(formatAssDialogueText('B: "지퍼 확인해."')).toEqual({
      text: '지퍼 확인해.',
      style: 'SpeakerB',
    });
  });

  it('shows digits in subtitles when dialogue uses spoken Korean numbers', () => {
    const { text, style } = formatAssDialogueText('A: "일곱개 남았어"');
    expect(style).toBe('SpeakerA');
    expect(text).toBe('7개 남았어');
  });

  it('shows digits for week counters in subtitles', () => {
    const { text } = formatAssDialogueText('B: "창가분 세주치 다른 음료드렸어요."');
    expect(text).toBe('창가분 3주치 다른 음료드렸어요.');
  });

  it('uses inline colors for multi-speaker line', () => {
    const { text, style } = formatAssDialogueText('B: "지퍼 확인해." A: "제발."');
    expect(style).toBe('Default');
    expect(text).toContain('지퍼 확인해.');
    expect(text).toContain('제발.');
    expect(text).not.toMatch(/\b[AB]\s*:/i);
    expect(text).toMatch(/\\c&H/);
  });

  it('preserves newline between speaker lines in ASS output', () => {
    const dialogue = 'A: "손님이 워낙 많아서..."\nB: "최고 공감인데 단골은 안기억나요?"';
    const { text, style } = formatAssDialogueText(dialogue);
    expect(style).toBe('Default');
    expect(text).toContain('\\N');
    expect(text).toContain('손님이 워낙 많아서');
    expect(text).toContain('최고 공감인데');
  });
});

describe('stripSpeakerLabel newlines', () => {
  it('preserves newline between speaker lines', () => {
    const dialogue = 'A: "손님이 워낙 많아서..."\nB: "최고 공감인데 단골은 안기억나요?"';
    expect(stripSpeakerLabel(dialogue)).toBe(
      '손님이 워낙 많아서...\n최고 공감인데 단골은 안기억나요?',
    );
  });
});

describe('buildAssContent', () => {
  const subtitleStyle: SubtitleStyle = {
    font: 'Noto Sans KR Bold',
    position: 'bottom_center',
    timing: 'sync_dialogue',
    boxStyle: 'outline_only',
  };

  it('builds dialogue lines without TDZ on style param', () => {
    const conti: VideoConti = {
      characters: [],
      location: '거실',
      lighting: '밝음',
      timeOfDay: '낮',
      cutType: 'multi_shot',
      duration: 10,
      scenarioSummary: '테스트',
      fullText: '테스트',
      shots: [
        {
          shotNumber: 1,
          startSec: 0,
          endSec: 3,
          camera: '와이드',
          action: 'A가 문을 연다',
          dialogue: 'A: "안녕"',
        },
        {
          shotNumber: 2,
          startSec: 3,
          endSec: 6,
          camera: '클로즈',
          action: 'B가 고개를 든다',
          dialogue: 'B: "응?"',
        },
      ],
    };
    const ass = buildAssContent(conti, subtitleStyle);
    expect(ass).toContain('Dialogue:');
    expect(ass).toContain('SpeakerA');
    expect(ass).toContain('SpeakerB');
    // bottom_center base 50 + 1 line × ~50px
    expect(ass).toContain(',20,20,100,1');
  });

  it('builds preview events with timing windows', () => {
    const conti: VideoConti = {
      characters: [],
      location: '거실',
      lighting: '밝음',
      timeOfDay: '낮',
      cutType: 'multi_shot',
      duration: 6,
      scenarioSummary: '테스트',
      fullText: '테스트',
      shots: [
        {
          shotNumber: 1,
          startSec: 0,
          endSec: 3,
          camera: '와이드',
          action: 'A',
          dialogue: 'A: "안녕"',
        },
      ],
    };
    const events = buildSubtitlePreviewEvents(conti, subtitleStyle);
    expect(events).toHaveLength(1);
    expect(events[0]!.text).toBe('안녕');
    expect(events[0]!.speakerStyle).toBe('A');
    expect(events[0]!.startSec).toBeLessThan(events[0]!.endSec);
  });

  it('shows multiline dialogue sequentially in input order (A then B)', () => {
    const conti: VideoConti = {
      characters: [],
      location: '거실',
      lighting: '밝음',
      timeOfDay: '낮',
      cutType: 'multi_shot',
      duration: 6,
      scenarioSummary: '테스트',
      fullText: '테스트',
      shots: [
        {
          shotNumber: 1,
          startSec: 0,
          endSec: 5,
          camera: '와이드',
          action: '대화',
          dialogue: 'A: "손님이 워낙 많아서..."\nB: "최고 공감인데 단골은 안기억나요?"',
        },
      ],
    };
    const ass = buildAssContent(conti, subtitleStyle);
    const dialogueLines = ass.split('\n').filter((line) => line.startsWith('Dialogue:'));
    expect(dialogueLines).toHaveLength(2);
    expect(dialogueLines[0]).toContain('SpeakerA');
    expect(dialogueLines[0]).toContain('손님이 워낙 많아서');
    expect(dialogueLines[1]).toContain('SpeakerB');
    expect(dialogueLines[1]).toContain('최고 공감인데');

    const events = buildSubtitlePreviewEvents(conti, subtitleStyle);
    expect(events).toHaveLength(2);
    expect(events[0]!.text).toBe('손님이 워낙 많아서...');
    expect(events[0]!.speakerStyle).toBe('A');
    expect(events[1]!.text).toBe('최고 공감인데 단골은 안기억나요?');
    expect(events[1]!.speakerStyle).toBe('B');
    expect(events[0]!.startSec).toBeLessThan(events[1]!.startSec);
    expect(events[0]!.endSec).toBeLessThanOrEqual(events[1]!.endSec);
  });

  it('shows digits in preview when dialogue uses spoken Korean numbers', () => {
    const conti: VideoConti = {
      characters: [],
      location: '거실',
      lighting: '밝음',
      timeOfDay: '낮',
      cutType: 'single_shot',
      duration: 5,
      scenarioSummary: '테스트',
      fullText: '테스트',
      shots: [
        {
          shotNumber: 1,
          startSec: 0,
          endSec: 5,
          camera: '미디엄',
          action: 'A',
          dialogue: 'A: "사십팔번이요?"',
        },
      ],
    };
    const ass = buildAssContent(conti, subtitleStyle);
    expect(ass).toContain('48번이요');
    expect(ass).not.toContain('사십팔번');

    const events = buildSubtitlePreviewEvents(conti, subtitleStyle);
    expect(events[0]!.text).toBe('48번이요?');
  });

  it('assigns sequential time windows per physical line', () => {
    const dialogue = 'A: "손님이 워낙 많아서..."\nB: "최고 공감인데 단골은 안기억나요?"';
    const cues = buildTimedDialogueCues({
      dialogue,
      style: subtitleStyle,
      startSec: 1,
      endSec: 5,
    });
    expect(cues).toHaveLength(2);
    expect(cues[0]!.assStyle).toBe('SpeakerA');
    expect(cues[1]!.assStyle).toBe('SpeakerB');
    expect(cues[0]!.marginV).toBe(cues[1]!.marginV);
    expect(cues[0]!.startSec).toBeLessThan(cues[1]!.startSec);
  });
});
