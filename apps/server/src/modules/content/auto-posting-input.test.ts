import { describe, expect, it } from 'vitest';
import {
  buildPananaPostingUrl,
  buildQuizPostingUrl,
  buildYeonunPostingUrl,
  deriveFallbackTitleFromUrl,
} from './auto-posting-input.js';

describe('auto-posting URL builders', () => {
  it('builds yeonun fortune URL', () => {
    expect(buildYeonunPostingUrl('2026-saju')).toBe('https://yeonun.com/fortune/2026-saju');
  });

  it('builds quiz test URL', () => {
    expect(buildQuizPostingUrl('phase3-emoji-movie-idiom-quiz')).toBe(
      'https://www.myquizoasis.com/ko/test/phase3-emoji-movie-idiom-quiz',
    );
  });

  it('builds panana character URL', () => {
    expect(buildPananaPostingUrl('new-character-34')).toBe('https://panana.kr/c/new-character-34');
  });
});

describe('deriveFallbackTitleFromUrl', () => {
  it('extracts quiz slug as title fallback', () => {
    expect(
      deriveFallbackTitleFromUrl(
        'quizoasis',
        'https://www.myquizoasis.com/ko/test/phase3-emoji-movie-idiom-quiz',
      ),
    ).toBe('phase3-emoji-movie-idiom-quiz');
  });

  it('extracts panana id as title fallback', () => {
    expect(deriveFallbackTitleFromUrl('panana', 'https://panana.kr/c/new-character-34')).toBe(
      'new-character-34',
    );
  });
});
