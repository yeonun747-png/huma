import { describe, expect, it } from 'vitest';
import {
  avoidCrossPostingCollision,
  avoidDongleAwareScheduleCollision,
  CROSS_POSTING_STAGGER_MS,
  SAME_DONGLE_STAGGER_MS,
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

describe('avoidDongleAwareScheduleCollision', () => {
  it('same dongle — pushes at least 50min apart (1h ±10min)', () => {
    const peer = { at: new Date('2026-06-22T10:00:00+09:00'), proxyPort: 10001 };
    const candidate = new Date('2026-06-22T10:05:00+09:00');
    const result = avoidDongleAwareScheduleCollision(candidate, [peer], 10001);
    expect(result.getTime() - peer.at.getTime()).toBeGreaterThanOrEqual(SAME_DONGLE_STAGGER_MS);
  });

  it('different dongle — soft spread only beyond 8min window', () => {
    const peer = { at: new Date('2026-06-22T10:00:00+09:00'), proxyPort: 10001 };
    const close = new Date('2026-06-22T10:05:00+09:00');
    const far = new Date('2026-06-22T10:09:00+09:00');
    expect(avoidDongleAwareScheduleCollision(far, [peer], 10002).getTime()).toBe(far.getTime());
    expect(
      avoidDongleAwareScheduleCollision(close, [peer], 10001).getTime() -
        avoidDongleAwareScheduleCollision(close, [peer], 10002).getTime(),
    ).toBeGreaterThan(0);
  });
});
