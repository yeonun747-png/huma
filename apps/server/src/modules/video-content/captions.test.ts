import { describe, expect, it } from 'vitest';
import { parseLlmJsonBlock } from '../../lib/llm-json.js';
import {
  fallbackPlatformCaptions,
  filterMeaningfulShortsHashtags,
  packInstagramCaption,
  packTiktokCaption,
  packYoutubeShortsTitle,
  sanitizeYoutubeShortsTitle,
} from './captions.js';
import type { VideoConti } from './types.js';

describe('generatePlatformCaptions JSON', () => {
  it('repairs unescaped quotes inside caption strings', () => {
    const raw = `{
  "captionYoutubeTitle": "오늘 "관재궁" 주의 #연운 #운세",
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
    expect(caps.captionYoutubeTitle).toContain('#연운');
    expect(caps.captionYoutubeTitle).not.toMatch(/#Shorts/i);
    expect(caps.captionYoutubeDescription).not.toContain('#Shorts');
    expect(caps.captionYoutubeTitle.length).toBeGreaterThanOrEqual(85);
    expect(caps.captionTiktok).not.toMatch(/#fyp\b/i);
    expect(caps.captionTiktok).not.toMatch(/#viral\b/i);
    expect(caps.captionTiktok).toMatch(/#연운/);
    const tiktokTags = caps.captionTiktok.match(/#[^\s#]+/g) ?? [];
    expect(tiktokTags.length).toBeGreaterThanOrEqual(10);
    expect(caps.captionInstagram).toContain('편의점');
    expect(caps.captionInstagram).not.toMatch(/https?:\/\//);
    const instagramTags = caps.captionInstagram.match(/#[^\s#]+/g) ?? [];
    expect(instagramTags.length).toBeGreaterThanOrEqual(10);
    expect(caps.captionInstagram.length).toBeLessThanOrEqual(2200);
  });
});

describe('packYoutubeShortsTitle', () => {
  it('fills up to 100 chars with hashtags', () => {
    const conti: VideoConti = {
      characters: [],
      location: '편의점',
      lighting: '밝음',
      timeOfDay: '낮',
      cutType: 'multi_shot',
      duration: 11,
      scenarioSummary: '편의점 선반 붕괴 펀치라인 반전',
      fullText: '',
      shots: [],
    };
    const caps = fallbackPlatformCaptions('yeonun', conti);
    expect(caps.captionYoutubeTitle.length).toBeGreaterThanOrEqual(85);
    expect(caps.captionYoutubeTitle.length).toBeLessThanOrEqual(100);
    expect(caps.captionYoutubeTitle).toContain('편의점');
    expect(caps.captionYoutubeTitle).toContain('#연운');
  });
});

describe('packTiktokCaption', () => {
  it('packs many hashtags up to 4000 chars without URL in body', () => {
    const tags = [
      '#연운', '#커리어운세', '#오늘의운세', '#사주', '#직장운', '#운세추천', '#신입직장인', '#직장인공감',
      '#협상', '#계약', '#운세앱', '#일간', '#사주팔자', '#운세풀이', '#직장인브이로그', '#직장생활',
    ];
    const packed = packTiktokCaption('짧은 본문\n프로필 링크 확인 👆', tags);
    expect(packed).toContain('짧은 본문');
    expect(packed).not.toMatch(/https?:\/\//);
    expect((packed.match(/#[^\s#]+/g) ?? []).length).toBeGreaterThanOrEqual(10);
    expect(packed.length).toBeLessThanOrEqual(4000);
  });
});

describe('packInstagramCaption', () => {
  it('packs many hashtags up to 2200 chars without URL in body', () => {
    const tags = [
      '#연운', '#커리어운세', '#오늘의운세', '#사주', '#직장운', '#운세추천', '#신입직장인', '#직장인공감',
      '#협상', '#계약', '#운세앱', '#일간', '#사주팔자', '#운세풀이', '#직장인릴스', '#직장생활',
    ];
    const packed = packInstagramCaption('짧은 본문\n프로필 링크 확인 👆', tags);
    expect(packed).toContain('짧은 본문');
    expect(packed).not.toMatch(/https?:\/\//);
    expect((packed.match(/#[^\s#]+/g) ?? []).length).toBeGreaterThanOrEqual(10);
    expect(packed.length).toBeLessThanOrEqual(2200);
  });
});

describe('filterMeaningfulShortsHashtags', () => {
  it('drops english viral tags and dialogue fragments', () => {
    const filtered = filterMeaningfulShortsHashtags([
      '#fyp',
      '#viral',
      '#연운',
      '#직장운',
      '#지은이',
      '#한다고',
      '#신입직장인',
      '#tiktokkorea',
    ]);
    expect(filtered).toContain('#연운');
    expect(filtered).toContain('#직장운');
    expect(filtered).toContain('#신입직장인');
    expect(filtered.some((t) => t.toLowerCase() === '#fyp')).toBe(false);
    expect(filtered.some((t) => t.includes('지은이'))).toBe(false);
  });
});

describe('sanitizeYoutubeShortsTitle', () => {
  it('strips #Shorts and normalizes spaces', () => {
    expect(sanitizeYoutubeShortsTitle('제목 #연운 #Shorts')).toBe('제목 #연운');
    expect(sanitizeYoutubeShortsTitle('제목  Shorts  #퀴즈')).toBe('제목 #퀴즈');
  });
});
