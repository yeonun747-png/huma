export type MissReason = '외부링크 포함' | '글자수 부족' | 'AI패턴 의심';

/** status=miss 포스트 누락 원인 추정 (스펙 §5) */
export function inferMissReason(params: { extLinkCount: number; charCount: number }): MissReason {
  if (params.extLinkCount > 0) return '외부링크 포함';
  if (params.charCount < 300) return '글자수 부족';
  return 'AI패턴 의심';
}
