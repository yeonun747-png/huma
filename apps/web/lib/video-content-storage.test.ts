import { describe, expect, it } from 'vitest';
import { groupStorageFiles, type VideoContentStorageItem } from './video-content-storage';

function item(id: string, created_at: string, bytes = 100): VideoContentStorageItem {
  return {
    id,
    account_id: 'acc-1',
    workspace: 'yeonun',
    status: 'completed',
    scenario_summary: null,
    created_at,
    similarity_score: null,
    hasSubtitled: true,
    hasSource: false,
    subtitledBytes: bytes,
    sourceBytes: 0,
    totalBytes: bytes,
    allPlatformsUploaded: false,
    latestUploadAt: null,
    ageDays: 0,
    durationSec: 10,
  };
}

describe('groupStorageFiles', () => {
  it('sorts pairs by created_at descending (newest leftmost)', () => {
    const pairs = groupStorageFiles([
      item('old', '2026-06-20T10:00:00.000Z', 9999),
      item('new', '2026-06-23T14:00:00.000Z', 1),
      item('mid', '2026-06-22T12:00:00.000Z', 5000),
    ]);
    expect(pairs.map((p) => p.historyId)).toEqual(['new', 'mid', 'old']);
  });
});
