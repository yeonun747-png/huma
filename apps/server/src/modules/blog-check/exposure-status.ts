export type PostExposureStatus = 'strong' | 'good' | 'weak' | 'collect' | 'miss';

export interface PostRankResult {
  status: PostExposureStatus;
  rank: number | null;
}

/** 제목 검색 순위 → 노출 등급 (1~30위) */
export function rankToExposureStatus(rank: number): PostExposureStatus {
  if (rank <= 3) return 'strong';
  if (rank <= 10) return 'good';
  return 'weak';
}

export const EXPOSURE_STATUS_LABEL: Record<PostExposureStatus, string> = {
  strong: '강함',
  good: '양호',
  weak: '약함',
  collect: '수집',
  miss: '누락',
};
