import { describe, expect, it } from 'vitest';
import { formatKstDateKey } from './posting-daily-target.js';
import { isPostingQuotaOvercommitted, kstTodayStartIso } from './posting-daily-status.js';

describe('kstTodayStartIso', () => {
  it('aligns with formatKstDateKey midnight KST', () => {
    const date = new Date('2026-06-22T15:00:00+09:00');
    const key = formatKstDateKey(date);
    expect(kstTodayStartIso(date)).toBe(new Date(`${key}T00:00:00+09:00`).toISOString());
  });
});

describe('isPostingQuotaOvercommitted', () => {
  it('allows pipeline at daily target', () => {
    expect(isPostingQuotaOvercommitted(0, 1, 0, 1)).toBe(false);
    expect(isPostingQuotaOvercommitted(1, 0, 0, 1)).toBe(false);
  });

  it('blocks when pipeline exceeds target', () => {
    expect(isPostingQuotaOvercommitted(0, 2, 0, 1)).toBe(true);
    expect(isPostingQuotaOvercommitted(0, 1, 1, 1)).toBe(true);
  });

  it('allows post_blog after content_full when only in-flight job is self (target 1)', () => {
    // 실행 중 content_full 1건은 목표와 같아도 초과가 아님 — assertAccountPostingQuota가 excludeJobId로 재검사
    expect(isPostingQuotaOvercommitted(0, 0, 0, 1)).toBe(false);
    expect(isPostingQuotaOvercommitted(0, 1, 0, 1)).toBe(false);
  });
});