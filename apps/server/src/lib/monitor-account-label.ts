import { formatPostingAccountLabel } from './posting-accounts.js';

/** 발행 모니터 카드 — huma_accounts 조인 결과 → 표시명 (연운1~3 slot_label 우선) */
export function monitorSessionAccountLabel(input: {
  accountName?: string | null;
  slotLabel?: string | null;
  resolvedLabel?: string | null;
}): string {
  if (input.resolvedLabel?.trim()) return input.resolvedLabel.trim();
  return (
    formatPostingAccountLabel({
      name: input.accountName,
      slot_label: input.slotLabel,
    }) ?? '계정'
  );
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
