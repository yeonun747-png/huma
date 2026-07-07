import { describe, expect, it } from 'vitest';
import {
  NARRATION_ROTATION_COOLDOWN_DAYS,
  comboKeyString,
  isComboBlocked,
  rotationCooldownDays,
} from './rotation.js';

describe('narration rotation', () => {
  it('uses period-specific cooldown', () => {
    expect(NARRATION_ROTATION_COOLDOWN_DAYS.daily).toBe(7);
    expect(NARRATION_ROTATION_COOLDOWN_DAYS.weekly).toBe(14);
    expect(rotationCooldownDays('monthly')).toBe(14);
  });

  it('builds stable combo keys with period', () => {
    const key = comboKeyString({
      workspace: 'yeonun',
      formatType: 'full_cover',
      periodType: 'daily',
      axisType: 'zodiac',
      topicKey: 'love-fortune',
    });
    expect(key).toBe('yeonun|full_cover|daily|zodiac|love-fortune');
  });

  it('blocks combos in the set', () => {
    const combo = {
      workspace: 'fortune82' as const,
      formatType: 'ranked' as const,
      periodType: 'weekly' as const,
      axisType: 'generation' as const,
      topicKey: 'tarot',
    };
    const blocked = new Set([comboKeyString(combo)]);
    expect(isComboBlocked(combo, blocked)).toBe(true);
    expect(
      isComboBlocked({ ...combo, periodType: 'daily' }, blocked),
    ).toBe(false);
  });
});
