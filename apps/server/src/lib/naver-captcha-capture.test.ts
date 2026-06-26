import { describe, expect, it } from 'vitest';

import { clampCaptureBox, unionCaptureBoxes } from './naver-captcha-capture.js';

describe('unionCaptureBoxes', () => {
  it('merges boxes with padding', () => {
    const union = unionCaptureBoxes(
      [
        { x: 100, y: 50, width: 200, height: 80 },
        { x: 80, y: 140, width: 240, height: 40 },
      ],
      10,
    );
    expect(union).toEqual({ x: 70, y: 40, width: 260, height: 150 });
  });

  it('returns null for empty input', () => {
    expect(unionCaptureBoxes([])).toBeNull();
  });
});

describe('clampCaptureBox', () => {
  it('clips to viewport bounds', () => {
    const clamped = clampCaptureBox({ x: -20, y: 10, width: 500, height: 300 }, { width: 400, height: 200 });
    expect(clamped.x).toBe(0);
    expect(clamped.y).toBe(10);
    expect(clamped.width).toBe(400);
    expect(clamped.height).toBe(190);
  });
});
