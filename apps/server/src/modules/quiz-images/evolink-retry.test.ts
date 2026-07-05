import { describe, expect, it } from 'vitest';
import axios from 'axios';
import { isRetryableEvoLinkRateLimit } from './evolink-image.js';

describe('isRetryableEvoLinkRateLimit', () => {
  it('detects axios 429', () => {
    const err = new axios.AxiosError('Too Many Requests', 'ERR_BAD_REQUEST', undefined, undefined, {
      status: 429,
      statusText: 'Too Many Requests',
      data: {},
      headers: {},
      config: {} as never,
    });
    expect(isRetryableEvoLinkRateLimit(err)).toBe(true);
  });

  it('detects rate limit message', () => {
    expect(isRetryableEvoLinkRateLimit(new Error('EvoLink API HTTP 429: rate limit'))).toBe(true);
  });

  it('ignores non-retryable errors', () => {
    expect(isRetryableEvoLinkRateLimit(new Error('invalid prompt'))).toBe(false);
  });
});
