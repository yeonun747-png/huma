import { describe, expect, it } from 'vitest';
import { EVOLINK_POLL_MAX_WAIT_MS, isEvoLinkPollTimeoutError } from './evolink.js';

describe('isEvoLinkPollTimeoutError', () => {
  it('detects poll timeout message', () => {
    expect(isEvoLinkPollTimeoutError('EvoLink 영상 생성 시간 초과 (20분)')).toBe(true);
  });

  it('rejects download errors', () => {
    expect(isEvoLinkPollTimeoutError('EvoLink 다운로드 실패: network')).toBe(false);
  });
});

describe('EVOLINK_POLL_MAX_WAIT_MS', () => {
  it('is 20 minutes', () => {
    expect(EVOLINK_POLL_MAX_WAIT_MS).toBe(20 * 60 * 1000);
  });
});
