import { describe, expect, it } from 'vitest';
import {
  avoidCrossPostingCollision,
  CROSS_POSTING_STAGGER_MS,
} from './posting-cross-stagger.js';

describe('avoidCrossPostingCollision', () => {
  it('keeps candidate when no conflict', () => {
    const base = new Date('2026-06-22T10:00:00+09:00');
    const result = avoidCrossPostingCollision(base, []);
    expect(result.getTime()).toBe(base.getTime());
  });

  it('pushes candidate at least 10min from occupied', () => {
    const occupied = [new Date('2026-06-22T10:00:00+09:00')];
    const candidate = new Date('2026-06-22T10:02:00+09:00');
    const result = avoidCrossPostingCollision(candidate, occupied, CROSS_POSTING_STAGGER_MS);
    expect(result.getTime() - occupied[0]!.getTime()).toBeGreaterThanOrEqual(CROSS_POSTING_STAGGER_MS);
  });
});
