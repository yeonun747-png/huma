import { describe, expect, it } from 'vitest';
import { isVideoContentInProgress, VideoContentCancelledError } from './conti-cancel.js';

describe('isVideoContentInProgress', () => {
  it('matches in-progress statuses', () => {
    expect(isVideoContentInProgress('conti_generating')).toBe(true);
    expect(isVideoContentInProgress('rendering')).toBe(true);
    expect(isVideoContentInProgress('generating')).toBe(true);
  });

  it('rejects terminal statuses', () => {
    expect(isVideoContentInProgress('conti_ready')).toBe(false);
    expect(isVideoContentInProgress('failed')).toBe(false);
  });
});

describe('VideoContentCancelledError', () => {
  it('carries history id', () => {
    const err = new VideoContentCancelledError('hist-1');
    expect(err.historyId).toBe('hist-1');
    expect(err.message).toContain('중지');
  });
});
