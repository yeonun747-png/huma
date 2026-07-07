import { describe, expect, it } from 'vitest';
import { resolveNarrationScriptProgress } from '@huma/shared';
import {
  mergeNarrationProgress,
  parseNarrationScriptProgressLog,
  resolveNarrationDisplayPercent,
} from './narration-script-progress';

describe('narration-script-progress', () => {
  it('parses socket log with percent', () => {
    const parsed = parseNarrationScriptProgressLog({
      message: '[narration-script] Sonnet 대본 작성 중… (40%)',
      metadata: {
        narration_script_history_id: 'abc-123',
        progress_percent: 40,
        progress_label: 'Sonnet 대본 작성 중…',
      },
    });
    expect(parsed?.historyId).toBe('abc-123');
    expect(parsed?.label).toBe('Sonnet 대본 작성 중…');
    expect(parsed?.percent).toBe(40);
  });

  it('reads progress from source_meta', () => {
    const p = resolveNarrationScriptProgress({
      progress_stage: 'llm_write',
      progress_label: 'Sonnet 대본 작성 중…',
      progress_percent: 40,
      progress_since_at: '2026-01-01T00:00:00.000Z',
    });
    expect(p?.percent).toBe(40);
    expect(p?.label).toContain('Sonnet');
  });

  it('merge keeps higher percent from polled meta when live socket is stale', () => {
    const merged = mergeNarrationProgress(
      {
        label: 'Sonnet 대본 작성 중…',
        percent: 45,
        stage: 'llm_write',
      },
      { label: 'Sonnet 대본 작성 중…', percent: 10 },
    );
    expect(merged?.percent).toBe(45);
  });

  it('display percent creeps during llm_write between server updates', () => {
    const now = Date.parse('2026-01-01T00:01:00.000Z');
    const pct = resolveNarrationDisplayPercent(
      {
        label: 'Sonnet',
        percent: 20,
        stage: 'llm_write',
        sinceAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:30.000Z',
      },
      now,
    );
    expect(pct).toBeGreaterThan(20);
    expect(pct).toBeLessThanOrEqual(78);
  });
});
