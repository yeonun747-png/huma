import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../middleware/auth.js', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: { warmup_day: 1 } }),
        }),
      }),
    }),
  },
}));

import { resolveAutoPublishPlannedCountForDay } from './auto-publish-slot-planner.js';
import { formatKstDateKey } from './posting-daily-target.js';

describe('resolveAutoPublishPlannedCountForDay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('caps stored planned_count to daily warmup target', async () => {
    const today = formatKstDateKey();
    const planned = await resolveAutoPublishPlannedCountForDay('acc', today, 5);
    // warmup_day=1 → weekday cap 1
    expect(planned).toBe(1);
  });
});
