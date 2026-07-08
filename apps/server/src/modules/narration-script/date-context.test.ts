import { describe, expect, it } from 'vitest';
import { buildNarrationDateContext, hasAmbiguousAbsoluteMonthPhrase, kstMonthBoundaries } from './date-context.js';

describe('narration date-context', () => {
  it('builds daily context in KST', () => {
    const ctx = buildNarrationDateContext('daily', new Date('2026-07-07T15:00:00.000Z'));
    expect(ctx.absoluteLabel).toBe('2026년 7월 8일');
    expect(ctx.periodPhrase).toBe('오늘');
  });

  it('builds monthly context like weekly (no TOP series)', () => {
    const ctx = buildNarrationDateContext('monthly', new Date('2026-07-07T15:00:00.000Z'));
    expect(ctx.absoluteLabel).toBe('2026년 7월');
    expect(ctx.periodPhrase).toBe('이번 달');
    expect(ctx.promptBlock).toContain('[시점 — 월간]');
    expect(ctx.promptBlock).not.toContain('시리즈');
  });

  it('kst month boundaries', () => {
    const { startIso, endIso, year, month } = kstMonthBoundaries(
      new Date('2026-07-15T00:00:00.000Z'),
    );
    expect(year).toBe(2026);
    expect(month).toBe(7);
    expect(new Date(startIso).getTime()).toBeLessThan(new Date(endIso).getTime());
  });

  it('detects ambiguous absolute month phrases', () => {
    expect(hasAmbiguousAbsoluteMonthPhrase('이번 달 중순에는 좋아요')).toBe(false);
    expect(hasAmbiguousAbsoluteMonthPhrase('9월 초에는 주의하세요')).toBe(true);
  });
});
