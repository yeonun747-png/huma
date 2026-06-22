import { describe, expect, it } from 'vitest';
import { parseLlmJsonBlock } from '../../lib/llm-json.js';
import { fallbackPlatformCaptions } from './captions.js';
import type { VideoConti } from './types.js';

describe('generatePlatformCaptions JSON', () => {
  it('repairs unescaped quotes inside caption strings', () => {
    const raw = `{
  "captionYoutube": "오늘 "관재궁" 주의했는데 진열대가 무너졌어요 #연운",
  "captionTiktok": "짧은 캡션",
  "captionInstagram": "짧은 캡션",
  "captionThreads": "짧은 캡션",
  "captionX": "짧은 캡션",
  "firstCommentThreads": null,
  "firstCommentX": null
}`;
    const parsed = parseLlmJsonBlock(raw) as Record<string, unknown>;
    expect(String(parsed.captionYoutube)).toContain('관재궁');
  });
});

describe('fallbackPlatformCaptions', () => {
  it('uses scenario summary when LLM captions fail', () => {
    const conti: VideoConti = {
      characters: [],
      location: '편의점',
      lighting: '밝음',
      timeOfDay: '낮',
      cutType: 'multi_shot',
      duration: 11,
      scenarioSummary: '편의점 선반 붕괴 펀치',
      fullText: '',
      shots: [],
    };
    const caps = fallbackPlatformCaptions('yeonun', conti);
    expect(caps.captionYoutube).toContain('편의점');
  });
});
