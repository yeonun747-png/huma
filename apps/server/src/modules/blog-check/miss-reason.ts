export type MissReason =
  | '외부링크 포함'
  | '발행간격 규칙적'
  | '글자수 부족'
  | 'AI패턴 의심';

function publishMinutesStdDev(times: string[]): number | null {
  if (times.length < 2) return null;
  const minutes = times
    .map((t) => {
      const d = new Date(t);
      return d.getHours() * 60 + d.getMinutes();
    })
    .filter((m) => Number.isFinite(m));
  if (minutes.length < 2) return null;
  const avg = minutes.reduce((a, b) => a + b, 0) / minutes.length;
  const variance = minutes.reduce((s, m) => s + (m - avg) ** 2, 0) / minutes.length;
  return Math.sqrt(variance);
}

/** status=miss 포스트 누락 원인 추정 (스펙 §5) */
export function inferMissReason(params: {
  extLinkCount: number;
  charCount: number;
  recentPublishTimes: string[];
}): MissReason {
  if (params.extLinkCount > 0) return '외부링크 포함';
  const std = publishMinutesStdDev(params.recentPublishTimes);
  if (std != null && std < 30) return '발행간격 규칙적';
  if (params.charCount < 300) return '글자수 부족';
  return 'AI패턴 의심';
}
