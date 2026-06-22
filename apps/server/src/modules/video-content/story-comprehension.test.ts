import { describe, expect, it } from 'vitest';
import { parseComprehensionVerdict } from './story-comprehension.js';

describe('parseComprehensionVerdict', () => {
  it('parses clear', () => {
    expect(parseComprehensionVerdict('clear')).toBe('clear');
    expect(parseComprehensionVerdict('Clear.')).toBe('clear');
  });

  it('parses unclear', () => {
    expect(parseComprehensionVerdict('unclear')).toBe('unclear');
    expect(parseComprehensionVerdict('')).toBe('unclear');
  });
});
