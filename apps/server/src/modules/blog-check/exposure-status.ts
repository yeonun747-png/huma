export type PostExposureStatus = 'strong' | 'good' | 'weak' | 'miss';

export interface PostRankResult {
  status: PostExposureStatus;
  rank: number | null;
}

/** 검색 순위 → 노출 등급 (스펙 §2) */
export function rankToExposureStatus(rank: number | null): PostExposureStatus {
  if (rank == null || rank <= 0) return 'miss';
  if (rank <= 3) return 'strong';
  if (rank <= 10) return 'good';
  return 'weak';
}

export const EXPOSURE_STATUS_LABEL: Record<PostExposureStatus, string> = {
  strong: '강함',
  good: '양호',
  weak: '약함',
  miss: '누락',
};
