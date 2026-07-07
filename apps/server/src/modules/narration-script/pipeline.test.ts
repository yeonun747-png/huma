import { describe, expect, it } from 'vitest';

describe('narration job id handling', () => {
  it('destructuring { id } from a string yields undefined (the enqueue bug)', () => {
    const idFromJob = '550e8400-e29b-41d4-a716-446655440000';
    const { id: broken } = idFromJob;
    expect(broken).toBeUndefined();
  });
});
