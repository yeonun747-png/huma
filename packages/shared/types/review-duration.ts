/** 본문 길이(대략) → 발행 전 검토 시간(대략) */
export const REVIEW_DURATION_BY_LENGTH = [
  { lengthLabel: '600~700자', timeLabel: '45초~1.5분', minMs: 45_000, maxMs: 90_000 },
  { lengthLabel: '700~800자', timeLabel: '1.3~3.3분', minMs: 78_000, maxMs: 198_000 },
  { lengthLabel: '900~1000자', timeLabel: '2~5분', minMs: 120_000, maxMs: 300_000 },
] as const;

export const REVIEW_DURATION_SUMMARY = REVIEW_DURATION_BY_LENGTH.map(
  (r) => `${r.lengthLabel} ${r.timeLabel}`,
).join(' · ');

function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** 본문 글자수 → [minMs, maxMs] */
export function resolveReviewDurationRange(charCount: number): [number, number] {
  const n = Math.max(0, Math.floor(charCount));
  if (n >= 900) return [120_000, 300_000];
  if (n >= 700) return [78_000, 198_000];
  return [45_000, 90_000];
}

export function calcReviewDurationMs(charCount: number, _legacyReviewMs?: [number, number]): number {
  const [lo, hi] = resolveReviewDurationRange(charCount);
  return randomBetween(lo, hi);
}
