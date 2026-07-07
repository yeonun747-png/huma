import { describe, expect, it } from 'vitest';
import { narrationScriptQueueJobId } from './cancel.js';

describe('narration cancel', () => {
  it('builds stable queue job id', () => {
    expect(narrationScriptQueueJobId('abc-123')).toBe('narration-script-abc-123');
  });
});
