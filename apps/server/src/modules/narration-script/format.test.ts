import { describe, expect, it } from 'vitest';
import {
  buildFallbackNarrationTitle,
  normalizeNarrationBody,
  validateNarrationTitle,
} from './format.js';
import { sanitizeNarrationDraft, validateNarrationDraft } from './validation.js';

describe('narration format', () => {
  it('removes blank lines between sentences', () => {
    expect(normalizeNarrationBody('오프닝.\n\n쥐띠: 문장.\n\n소띠: 문장.')).toBe(
      '오프닝.\n쥐띠: 문장.\n소띠: 문장.',
    );
  });

  it('requires axis in title', () => {
    const bad = validateNarrationTitle('초년부터 말년까지, 내 평생의 흐름을 한눈에', 'zodiac');
    expect(bad.ok).toBe(false);
  });

  it('accepts constellation axis title pattern', () => {
    const ok = validateNarrationTitle(
      '별자리로 알아보는 그 사람과 다시 만날 수 있을까',
      'constellation',
    );
    expect(ok.ok).toBe(true);
  });

  it('builds fallback title with axis prefix', () => {
    expect(buildFallbackNarrationTitle('그 사람과 다시 만날 수 있을까', 'constellation', 'full_cover')).toBe(
      '별자리로 알아보는 그 사람과 다시 만날 수 있을까',
    );
  });
});

describe('validateNarrationDraft', () => {
  it('sanitize removes blank lines before validation', () => {
    const draft = sanitizeNarrationDraft({
      title: '띠별로 알아보는 평생 대운, 당신 띠는?',
      body: '오프닝 문장입니다.\n\n쥐띠: a',
    });
    expect(draft.body).toBe('오프닝 문장입니다.\n쥐띠: a');
    expect(draft.body).not.toMatch(/\n\n/);
  });
});
