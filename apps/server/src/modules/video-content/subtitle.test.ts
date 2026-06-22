import { describe, expect, it } from 'vitest';
import type { SubtitleStyle, VideoConti } from './types.js';
import { buildAssContent, formatAssDialogueText, parseDialogueSegments, stripSpeakerLabel } from './subtitle.js';

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

  it('uses inline colors for multi-speaker line', () => {
    const { text, style } = formatAssDialogueText('B: "지퍼 확인해." A: "제발."');
    expect(style).toBe('Default');
    expect(text).toContain('지퍼 확인해.');
    expect(text).toContain('제발.');
    expect(text).not.toMatch(/\b[AB]\s*:/i);
    expect(text).toMatch(/\\c&H/);
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
  });
});
