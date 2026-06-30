import type { Workspace } from '@huma/shared';
import { POSTING_DONGLE_SLOTS } from '@huma/shared';

export type PostingAccountOption = {
  id: string;
  label: string;
  proxy_port?: number;
};

export type PostingDongleAccountGroup = {
  dongle_label: string;
  proxy_port: number;
  accounts: PostingAccountOption[];
};

/** workspace 포스팅 계정을 동글 그룹으로 묶음 (빈 동글 포함) */
export function groupPostingAccountsByDongle(
  workspace: Workspace,
  options: PostingAccountOption[],
): PostingDongleAccountGroup[] {
  const slots = POSTING_DONGLE_SLOTS.filter((s) => s.workspace === workspace);
  return slots.map((slot) => ({
    dongle_label: slot.label,
    proxy_port: slot.proxyPort,
    accounts: options
      .filter((a) => a.proxy_port === slot.proxyPort)
      .sort((a, b) => a.label.localeCompare(b.label, 'ko')),
  }));
}

export function flattenPostingAccountOptions(
  groups: PostingDongleAccountGroup[],
): PostingAccountOption[] {
  return groups.flatMap((g) => g.accounts);
}
