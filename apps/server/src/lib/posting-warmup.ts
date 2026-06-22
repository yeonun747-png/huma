/**
 * 포스팅 계정 워밍업 — huma_accounts.warmup_day(일일 활동 일수) 기준 점진적 일일 상한.
 * C-Rank와 동일 필드를 공유하므로, 이미 오래 쓰인 계정은 상한이 빨리 풀림.
 */

/** 절대 최소 발행 간격(시간) — human_engine 설정 하한 */
export const ABSOLUTE_MIN_PUBLISH_INTERVAL_HOURS = 2;

/** warmup_day별 평일 최대 발행 건수 (이후 4~5 목표 적용) */
export function getPostingWarmupWeekdayCap(warmupDay: number): number {
  const d = Math.max(0, warmupDay);
  if (d <= 2) return 1;
  if (d <= 5) return 2;
  if (d <= 9) return 3;
  if (d <= 14) return 4;
  return 999;
}

export function applyPostingWarmupCap(
  rawTarget: number,
  warmupDay: number,
  isWeekend: boolean,
  weekendRatio?: number,
): number {
  const cap = getPostingWarmupWeekdayCap(warmupDay);
  if (cap >= 999) return rawTarget;

  if (isWeekend) {
    const ratio = weekendRatio ?? 0.45;
    const weekendCap = Math.max(1, Math.round(cap * ratio));
    return Math.min(rawTarget, weekendCap);
  }

  return Math.min(rawTarget, cap);
}

export type PostingWarmupStage = 'initial' | 'adapt' | 'expand' | 'late' | 'complete';

/** UI·설정 — warmup_day 단계 설명 */
export function describePostingWarmupPhase(warmupDay: number): {
  stage: PostingWarmupStage;
  label: string;
  weekday_cap: number | null;
} {
  const d = Math.max(0, warmupDay);
  const cap = getPostingWarmupWeekdayCap(d);
  if (cap >= 999) {
    return { stage: 'complete', label: '완료 · 평일 4~5건', weekday_cap: null };
  }

  const stage: PostingWarmupStage =
    d <= 2 ? 'initial' : d <= 5 ? 'adapt' : d <= 9 ? 'expand' : 'late';
  const stageKo =
    stage === 'initial'
      ? '초기'
      : stage === 'adapt'
        ? '적응'
        : stage === 'expand'
          ? '확대'
          : '후반';

  return {
    stage,
    label: `${stageKo} ${d}일차 · 평일 최대 ${cap}건/일`,
    weekday_cap: cap,
  };
}
