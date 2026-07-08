import { describe, expect, it } from 'vitest';
import { inferNarrationAxisFromTopic } from './axis-inference.js';

describe('inferNarrationAxisFromTopic', () => {
  it('자미두수·별의 흐름 → 별자리', () => {
    expect(inferNarrationAxisFromTopic('2026 자미두수 별의 흐름')).toBe('constellation');
  });

  it('띠별 이직운 → 띠', () => {
    expect(inferNarrationAxisFromTopic('띠별 이직·승진운')).toBe('zodiac');
  });

  it('연령대 재물운 → 연령대', () => {
    expect(inferNarrationAxisFromTopic('90년대생 연령대별 재물운')).toBe('generation');
  });

  it('모호하면 null', () => {
    expect(inferNarrationAxisFromTopic('2026 하반기 종합운')).toBeNull();
  });
});
