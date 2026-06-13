/** 본문 길이(대략) → 발행 전 검토 시간 — 45초~2분 상한 */
export const REVIEW_DURATION_BY_LENGTH = [
  { lengthLabel: '600자 미만', timeLabel: '45초~1분', minMs: 45_000, maxMs: 60_000 },
  { lengthLabel: '600~900자', timeLabel: '50초~1.5분', minMs: 50_000, maxMs: 90_000 },
  { lengthLabel: '900자 이상', timeLabel: '1분~2분', minMs: 60_000, maxMs: 120_000 },
] as const;

export const REVIEW_DURATION_SUMMARY = REVIEW_DURATION_BY_LENGTH.map(
  (r) => `${r.lengthLabel} ${r.timeLabel}`,
).join(' · ');

function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** 본문 글자수 → [minMs, maxMs] (45초~2분) */
export function resolveReviewDurationRange(charCount: number): [number, number] {
  const n = Math.max(0, Math.floor(charCount));
  if (n >= 900) return [60_000, 120_000];
  if (n >= 600) return [50_000, 90_000];
  return [45_000, 60_000];
}

export function calcReviewDurationMs(charCount: number, _legacyReviewMs?: [number, number]): number {
  const [lo, hi] = resolveReviewDurationRange(charCount);
  return randomBetween(lo, hi);
}
