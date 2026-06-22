import { describe, expect, it } from 'vitest';
import {
  parseVideoContentProgressStage,
  resolveVideoContentProgressHistoryId,
} from './video-content-progress';

describe('parseVideoContentProgressStage', () => {
  it('parses stage with metadata history id', () => {
    expect(
      parseVideoContentProgressStage({
        message: '[video-content] 3a단계 자유 서술 (재미)',
        metadata: { video_content_history_id: 'abc-123' },
      }),
    ).toEqual({ historyId: 'abc-123', stage: '3a단계 자유 서술 (재미)' });
  });

  it('parses history id from message suffix', () => {
    const id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    expect(
      parseVideoContentProgressStage({
        message: `[video-content] 유머 평가 1/3 — history=${id}`,
      }),
    ).toEqual({ historyId: id, stage: '유머 평가 1/3' });
  });

  it('skips token settings noise', () => {
    expect(
      parseVideoContentProgressStage({
        message: '[video-content] Sonnet/Haiku 토큰 …',
      }),
    ).toBeNull();
  });
});

describe('resolveVideoContentProgressHistoryId', () => {
  it('prefers explicit history id', () => {
    expect(
      resolveVideoContentProgressHistoryId({
        payload: { account_id: 'acc-1' },
        parsed: { historyId: 'hist-1', stage: '3b' },
        items: [],
        selectedId: 'hist-2',
      }),
    ).toBe('hist-1');
  });
});
