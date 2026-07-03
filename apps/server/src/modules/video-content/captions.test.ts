import { describe, expect, it } from 'vitest';
import { parseLlmJsonBlock } from '../../lib/llm-json.js';
import { fallbackPlatformCaptions } from './captions.js';
import type { VideoConti } from './types.js';

describe('generatePlatformCaptions JSON', () => {
  it('repairs unescaped quotes inside caption strings', () => {
    const raw = `{
  "captionYoutubeTitle": "오늘 "관재궁" 주의 #연운 #Shorts",
  "captionYoutubeDescription": "2줄 설명\\n\\nhttps://example.com",
  "captionTiktok": "짧은 캡션",
  "captionInstagram": "짧은 캡션",
  "captionThreads": "짧은 캡션",
  "captionX": "짧은 캡션",
  "firstCommentThreads": null,
  "firstCommentX": null
}`;
    const parsed = parseLlmJsonBlock(raw) as Record<string, unknown>;
    expect(String(parsed.captionYoutubeTitle)).toContain('관재궁');
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
    expect(caps.captionYoutubeTitle).toContain('편의점');
    expect(caps.captionYoutubeDescription).toContain('편의점');
    expect(caps.captionYoutubeTitle).toContain('#Shorts');
    expect(caps.captionYoutubeDescription).not.toContain('#Shorts');
  });
});
