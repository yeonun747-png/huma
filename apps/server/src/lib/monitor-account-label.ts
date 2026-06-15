/** 발행 모니터 카드 — 계정·플랫폼 표시 */
export function monitorSessionAccountLabel(input: {
  workspace?: string | null;
  accountName?: string | null;
  jobType?: string | null;
  hasAccountId?: boolean;
}): string {
  const name = input.accountName?.trim();
  if (name) return name;

  if (input.workspace === 'yeonun' && (input.jobType === 'content_full' || !input.hasAccountId)) {
    return '연운계정1-3';
  }

  return '계정';
}

export function monitorSessionPlatformLabel(input: {
  workspace?: string | null;
  platform?: string | null;
  jobType?: string | null;
}): string {
  const platform = input.platform?.trim();
  if (platform && platform !== input.workspace) return platform;
  if (input.jobType === 'content_full') return 'naver';
  return platform ?? input.workspace ?? 'naver';
}
