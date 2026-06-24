import { describe, expect, it } from 'vitest';
import { deferAutoPublishRetryIso } from './auto-publish-state.js';

describe('deferAutoPublishRetryIso', () => {
  it('returns ISO within the requested minute window', () => {
    const before = Date.now();
    const iso = deferAutoPublishRetryIso(2, 4);
    const ms = new Date(iso).getTime() - before;
    expect(ms).toBeGreaterThanOrEqual(2 * 60_000 - 50);
    expect(ms).toBeLessThanOrEqual(4 * 60_000 + 50);
  });
});
