import { describe, expect, it } from 'vitest';
import { buildNarrationDateContext, hasAmbiguousAbsoluteMonthPhrase } from './date-context.js';

describe('narration date-context', () => {
  it('builds daily context in KST', () => {
    const ctx = buildNarrationDateContext('daily', new Date('2026-07-07T15:00:00.000Z'));
    expect(ctx.absoluteLabel).toBe('2026년 7월 8일');
    expect(ctx.periodPhrase).toBe('오늘');
  });

  it('builds monthly context', () => {
    const ctx = buildNarrationDateContext('monthly', new Date('2026-07-07T15:00:00.000Z'));
    expect(ctx.absoluteLabel).toBe('2026년 7월');
    expect(ctx.periodPhrase).toBe('이번 달');
  });

  it('detects ambiguous absolute month phrases', () => {
    expect(hasAmbiguousAbsoluteMonthPhrase('이번 달 중순에는 좋아요')).toBe(false);
    expect(hasAmbiguousAbsoluteMonthPhrase('9월 초에는 주의하세요')).toBe(true);
  });
});
