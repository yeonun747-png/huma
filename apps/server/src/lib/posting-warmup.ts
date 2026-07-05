/**
 * 포스팅 계정 워밍업 — huma_accounts.warmup_day(일일 활동 일수) 기준 점진적 일일 상한.
 * 자동발행 기준일(posting_warmup_started_kst) 이후 post_blog 발행일만 집계·보정.
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

/**
 * 발행 가능 시간대 내 랜덤 분산 비율 — warmup_day가 낮을수록 넓게(초기 계정 시간 군집 완화).
 * 1 = 활성창 전체, ~0.08 = 최소 간격 직후 근처만.
 */
export function postingWarmupScheduleSpreadFraction(warmupDay: number): number {
  const d = Math.max(0, warmupDay);
  if (d <= 2) return 1;
  if (d <= 5) return 0.75;
  if (d <= 9) return 0.5;
  if (d <= 14) return 0.25;
  return 0.08;
}

/**
 * 오늘 발행 목표 건수별 시간 분산 — 목표가 적을수록 8시대 군집 없이 활성창 전체에 배치.
 * 4~5건은 이른 시간(8시대) 밀집, 1~2건은 하루 종일 스프레드.
 */
export function postingDailyTargetSpreadFraction(dailyTarget: number): number {
  const t = Math.max(1, Math.round(dailyTarget));
  if (t >= 5) return 0.08;
  if (t >= 4) return 0.12;
  if (t >= 3) return 0.38;
  if (t >= 2) return 0.62;
  return 1;
}

/** 워밍업·일일 목표 중 더 넓은 분산 적용 — 저발행량 계정은 warmup 완료여도 8시대 고정 방지 */
export function resolvePostingScheduleSpreadFraction(warmupDay: number, dailyTarget: number): number {
  return Math.max(
    postingWarmupScheduleSpreadFraction(warmupDay),
    postingDailyTargetSpreadFraction(dailyTarget),
  );
}

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
