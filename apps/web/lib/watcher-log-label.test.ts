import { describe, expect, it } from 'vitest';
import { isWatcherRealtimeErrorLog } from './watcher-log-label';

describe('isWatcherRealtimeErrorLog', () => {
  it('excludes [video-content] operational errors', () => {
    expect(
      isWatcherRealtimeErrorLog({
        level: 'ERROR',
        message: '[video-content] 콘티 생성 실패 — filler action',
      }),
    ).toBe(false);
  });

  it('excludes [evolink] and [video-content-storage] errors', () => {
    expect(
      isWatcherRealtimeErrorLog({
        level: 'ERROR',
        message: '[evolink] 다운로드 실패 history=abc — timeout',
      }),
    ).toBe(false);
    expect(
      isWatcherRealtimeErrorLog({
        level: 'ERROR',
        message: '[video-content-storage] 스케줄 정리 실패 — disk full',
      }),
    ).toBe(false);
  });

  it('excludes unprefixed worker duplicate video-content errors', () => {
    expect(
      isWatcherRealtimeErrorLog({
        level: 'ERROR',
        message: 'EvoLink 영상 생성 시간 초과 (20분)',
      }),
    ).toBe(false);
    expect(
      isWatcherRealtimeErrorLog({
        level: 'ERROR',
        message: 'Unterminated string in JSON at position 42',
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
