import { describe, expect, it } from 'vitest';
import {
  NARRATION_ROTATION_COOLDOWN_DAYS,
  comboKeyString,
  isComboBlocked,
  pickLeastUsedAxis,
} from './rotation.js';

describe('narration rotation', () => {
  it('uses 14-day cooldown', () => {
    expect(NARRATION_ROTATION_COOLDOWN_DAYS).toBe(14);
  });

  it('builds stable combo keys', () => {
    const key = comboKeyString({
      workspace: 'yeonun',
      formatType: 'full_cover',
      axisType: 'zodiac',
      topicKey: 'love-fortune',
    });
    expect(key).toBe('yeonun|full_cover|zodiac|love-fortune');
  });

  it('blocks combos in the set', () => {
    const combo = {
      workspace: 'fortune82' as const,
      formatType: 'ranked' as const,
      axisType: 'generation' as const,
      topicKey: 'tarot',
    };
    const blocked = new Set([comboKeyString(combo)]);
    expect(isComboBlocked(combo, blocked)).toBe(true);
    expect(
      isComboBlocked({ ...combo, topicKey: 'other' }, blocked),
    ).toBe(false);
  });

  it('prefers least-used axis', () => {
    const usage = new Map([
      ['zodiac' as const, 5],
      ['constellation' as const, 1],
      ['generation' as const, 3],
    ]);
    const picked = pickLeastUsedAxis(['zodiac', 'constellation', 'generation'], usage);
    expect(picked).toBe('constellation');
  });
});
