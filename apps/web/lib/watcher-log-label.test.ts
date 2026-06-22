import { describe, expect, it } from 'vitest';
import { isWatcherRealtimeErrorLog } from './watcher-log-label';

describe('isWatcherRealtimeErrorLog', () => {
  it('excludes video-content operational errors', () => {
    expect(
      isWatcherRealtimeErrorLog({
        level: 'ERROR',
        message: '[video-content] 콘티 생성 실패 — filler action',
      }),
    ).toBe(false);
  });

  it('includes posting-related errors', () => {
    expect(
      isWatcherRealtimeErrorLog({
        level: 'ERROR',
        message: 'Layer4 CAPTCHA detected',
      }),
    ).toBe(true);
  });
});
