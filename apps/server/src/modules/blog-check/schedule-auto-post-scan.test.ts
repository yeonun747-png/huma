import { describe, expect, it } from 'vitest';
import { BLOG_CHECK_AUTO_SCAN_AFTER_PUBLISH_MS } from './constants.js';
import { computeAutoBlogPostScanDelayMs } from './schedule-auto-post-scan.js';

describe('computeAutoBlogPostScanDelayMs', () => {
  it('returns fixed delay from publish completion (not scheduled_at anchor)', () => {
    expect(computeAutoBlogPostScanDelayMs()).toBe(BLOG_CHECK_AUTO_SCAN_AFTER_PUBLISH_MS);
    expect(computeAutoBlogPostScanDelayMs()).toBe(20 * 60_000);
  });
});
