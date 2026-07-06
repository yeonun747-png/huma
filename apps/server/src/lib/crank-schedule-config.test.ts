import { describe, expect, it } from 'vitest';
import {
  distributeCrankScheduleSlotsKst,
  getKstClock,
  SESSION_SLOT_MINUTES,
} from './crank-schedule-config.js';

function kstMinuteKey(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Seoul',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const h = parts.find((p) => p.type === 'hour')?.value ?? '00';
  const m = parts.find((p) => p.type === 'minute')?.value ?? '00';
  return `${h}:${m}`;
}

describe('distributeCrankScheduleSlotsKst', () => {
  it('동일 트랙은 wave마다 25분 간격 (당일 보정)', () => {
    const anchor = new Date('2026-07-06T05:30:00.000Z'); // KST 14:30
    const slots = distributeCrankScheduleSlotsKst(17, 0, undefined, 2, {
      notBefore: anchor,
      excludeDeadZone: true,
    });

    const byTrack = new Map<number, string[]>();
    for (const s of slots) {
      const list = byTrack.get(s.track) ?? [];
      list.push(kstMinuteKey(s.at));
      byTrack.set(s.track, list);
    }

    for (const [, times] of byTrack) {
      expect(new Set(times).size).toBe(times.length);
      for (let w = 1; w < times.length; w++) {
        const prev = times[w - 1]!.split(':').map(Number);
        const cur = times[w]!.split(':').map(Number);
        const prevMin = prev[0]! * 60 + prev[1]!;
        const curMin = cur[0]! * 60 + cur[1]!;
        expect(curMin - prevMin).toBeGreaterThanOrEqual(SESSION_SLOT_MINUTES);
      }
    }
  });

  it('2트랙 wave0은 2~5분 시차', () => {
    const anchor = new Date('2026-07-06T05:30:00.000Z');
    const slots = distributeCrankScheduleSlotsKst(4, 0, undefined, 2, {
      notBefore: anchor,
    });
    const t0 = slots[0]!;
    const t1 = slots[1]!;
    expect(t0.track).toBe(0);
    expect(t1.track).toBe(1);
    const m0 = kstMinuteKey(t0.at).split(':').map(Number);
    const m1 = kstMinuteKey(t1.at).split(':').map(Number);
    const diff = m1[0]! * 60 + m1[1]! - (m0[0]! * 60 + m0[1]!);
    expect(diff).toBeGreaterThanOrEqual(2);
    expect(diff).toBeLessThanOrEqual(5);
  });
});
