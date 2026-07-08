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

  it('requires axis, period, and hook in title', () => {
    const bad = validateNarrationTitle(
      '초년부터 말년까지, 내 평생의 흐름을 한눈에',
      'zodiac',
      'daily',
      '대운',
    );
    expect(bad.ok).toBe(false);
  });

  it('accepts short hook title pattern with period', () => {
    const ok = validateNarrationTitle(
      '오늘 별자리 재회운, 당신만 해당?',
      'constellation',
      'daily',
      '재회운',
    );
    expect(ok.ok).toBe(true);
  });

  it('rejects catalog name in title', () => {
    const bad = validateNarrationTitle(
      '오늘 별자리로 알아보는 2026 일년 신년운세, 당신은?',
      'constellation',
      'weekly',
      '신년운세',
      '2026 일년 신년운세',
    );
    expect(bad.ok).toBe(false);
  });

  it('builds fallback title with hook and axis', () => {
    expect(buildFallbackNarrationTitle('재회운', 'constellation', 'full_cover', 'daily')).toBe(
      '오늘 별자리 재회운, 당신은?',
    );
    expect(buildFallbackNarrationTitle('작명', 'zodiac', 'ranked', 'monthly')).toBe(
      '이번 달 작명 띠 TOP5, 1위는?',
    );
  });
});

describe('validateNarrationDraft', () => {
  it('sanitize removes blank lines before validation', () => {
    const draft = sanitizeNarrationDraft({
      title: '오늘 띠별 재물운, 당신 띠는?',
      body: '오프닝 문장입니다.\n\n쥐띠: a',
    });
    expect(draft.body).toBe('오프닝 문장입니다.\n쥐띠: a');
    expect(draft.body).not.toMatch(/\n\n/);
  });
});
