import { describe, expect, it } from 'vitest';

/** pick 가중치 — 포스팅·최근 영상 미사용일수록 높음 */
function pickWeight(postingN: number, recentVideoN: number): number {
  return 1 / (1 + postingN + recentVideoN);
}

describe('yeonun product pick weight', () => {
  it('favors never-used products over heavily used ones', () => {
    expect(pickWeight(0, 0)).toBeGreaterThan(pickWeight(5, 0));
    expect(pickWeight(0, 0)).toBeGreaterThan(pickWeight(0, 3));
  });
});
