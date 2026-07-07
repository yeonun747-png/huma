import { describe, expect, it } from 'vitest';
import { resolveNarrationScriptProgress } from '@huma/shared';
import { parseNarrationScriptProgressLog } from './narration-script-progress';

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
});
