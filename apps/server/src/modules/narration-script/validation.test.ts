import { describe, expect, it } from 'vitest';
import { validateNarrationDraft } from './validation.js';

function draft(body: string) {
  return {
    title: '오늘 띠별로 알아보는 재물운 TOP5',
    body,
  };
}

/** 검증용 최소 본문 — 12띠 라벨 포함 */
function fullCoverZodiacBody(length: number): string {
  const labels =
    '쥐띠 소띠 호랑이띠 토끼띠 용띠 뱀띠 말띠 양띠 원숭이띠 닭띠 개띠 돼지띠';
  const pad = '가'.repeat(Math.max(0, length - labels.length - 20));
  return `오늘 운세입니다. ${pad} ${labels}`;
}

describe('validateNarrationDraft length bounds', () => {
  it('full_cover zodiac allows up to 1000 chars (not legacy 650)', () => {
    const body = fullCoverZodiacBody(900);
    expect(body.length).toBeGreaterThan(650);
    expect(body.length).toBeLessThanOrEqual(1000);
    const result = validateNarrationDraft(draft(body), 'full_cover', 'zodiac', 'daily');
    expect(result).toEqual({ ok: true });
  });

  it('rejects full_cover zodiac over 1000 chars', () => {
    const body = fullCoverZodiacBody(1100);
    expect(body.length).toBeGreaterThan(1000);
    const result = validateNarrationDraft(draft(body), 'full_cover', 'zodiac', 'daily');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('1000');
      expect(result.message).not.toContain('650');
    }
  });
});
