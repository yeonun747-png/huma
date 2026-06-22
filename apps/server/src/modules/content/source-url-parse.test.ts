import { describe, expect, it } from 'vitest';
import { extractPananaCharacterKey } from './panana-context.js';
import { extractQuizTestSlug } from './quizoasis-context.js';

describe('extractQuizTestSlug', () => {
  it('parses /test/{slug}', () => {
    expect(extractQuizTestSlug('https://www.myquizoasis.com/test/mbti-real-type')).toBe('mbti-real-type');
  });

  it('parses locale-prefixed /en/test/{slug}', () => {
    expect(extractQuizTestSlug('https://myquizoasis.com/en/test/love-style')).toBe('love-style');
  });

  it('parses query slug on quiz host', () => {
    expect(extractQuizTestSlug('https://myquizoasis.com/?slug=mbti')).toBe('mbti');
  });

  it('returns null for unrelated URLs', () => {
    expect(extractQuizTestSlug('https://yeonun.com/fortune/foo')).toBeNull();
  });
});

describe('extractPananaCharacterKey', () => {
  it('parses /character/{id}', () => {
    expect(extractPananaCharacterKey('https://panana.kr/character/abc-123')).toBe('abc-123');
  });

  it('parses /chat/{id}', () => {
    expect(extractPananaCharacterKey('https://panana.kr/chat/hero-uuid')).toBe('hero-uuid');
  });

  it('parses characterId query param', () => {
    expect(extractPananaCharacterKey('https://panana.kr/?characterId=uuid-1')).toBe('uuid-1');
  });

  it('returns null for generic home path', () => {
    expect(extractPananaCharacterKey('https://panana.kr/')).toBeNull();
  });
});
