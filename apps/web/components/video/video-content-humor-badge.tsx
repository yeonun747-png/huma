'use client';

import { formatSelfAssessedHumor, isDullHumorAssessment } from '@/lib/video-content-status';

export function VideoContentHumorBadge({
  humor,
  className = '',
  showFunny = false,
}: {
  humor?: string | null;
  className?: string;
  /** false면 dull만 표시 (목록 노이즈 감소) */
  showFunny?: boolean;
}) {
  if (isDullHumorAssessment(humor)) {
    return (
      <span
        className={`inline-flex shrink-0 items-center rounded bg-amber-500/25 px-1.5 py-0.5 text-[9px] font-semibold text-amber-800 dark:text-amber-200 ${className}`}
        title="Haiku 유머 평가 — 수동 검토 권장"
      >
        ⚠ 재미 부족
      </span>
    );
  }
  if (showFunny && humor === 'funny') {
    return (
      <span
        className={`inline-flex shrink-0 items-center rounded bg-emerald-500/15 px-1.5 py-0.5 text-[9px] text-emerald-700 dark:text-emerald-300 ${className}`}
        title="Haiku 유머 평가"
      >
        ✓ {formatSelfAssessedHumor(humor)}
      </span>
    );
  }
  return null;
}

export function VideoContentHumorTableCell({ humor }: { humor?: string | null }) {
  if (isDullHumorAssessment(humor)) {
    return (
      <span className="rounded bg-amber-500/25 px-1 py-0.5 font-semibold text-amber-800 dark:text-amber-200">
        dull
      </span>
    );
  }
  if (humor === 'funny') {
    return <span className="text-huma-ok">funny</span>;
  }
  return <span className="text-huma-t4">—</span>;
}
