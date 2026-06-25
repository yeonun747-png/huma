import { describe, expect, it } from 'vitest';
import { BLOG_CHECK_AUTO_SCAN_AFTER_PUBLISH_MS } from './constants.js';
import { computeAutoBlogPostScanDelayMs } from './schedule-auto-post-scan.js';

describe('computeAutoBlogPostScanDelayMs', () => {
  it('returns remaining ms until publish + 10 minutes', () => {
    const publishedAt = '2026-06-22T10:00:00.000Z';
    const nowMs = Date.parse(publishedAt) + 3 * 60_000;
    expect(computeAutoBlogPostScanDelayMs(publishedAt, nowMs)).toBe(7 * 60_000);
  });

  it('returns 0 when publish + 10 minutes already passed', () => {
    const publishedAt = '2026-06-22T10:00:00.000Z';
    const nowMs = Date.parse(publishedAt) + BLOG_CHECK_AUTO_SCAN_AFTER_PUBLISH_MS + 5_000;
    expect(computeAutoBlogPostScanDelayMs(publishedAt, nowMs)).toBe(0);
  });

  it('falls back to full 10 minutes for invalid publish time', () => {
    expect(computeAutoBlogPostScanDelayMs('not-a-date')).toBe(BLOG_CHECK_AUTO_SCAN_AFTER_PUBLISH_MS);
  });
});
