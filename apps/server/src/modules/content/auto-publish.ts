import {
  getAutoPublishStatus,
  getAutoPublishStatusForAllAccounts,
  type AutoPublishStatus,
} from '../../lib/posting-daily-status.js';
import {
  disableAutoPublish,
  enableAutoPublish,
  setAutoPublishEnabled,
} from '../../lib/auto-publish-state.js';
import { resolvePostingAccount } from '../../lib/posting-accounts.js';

export async function fetchAutoPublishStatus(workspace: string): Promise<AutoPublishStatus> {
  const { getAutoPublishButtonStatus } = await import('../../lib/posting-daily-status.js');
  return getAutoPublishButtonStatus(workspace);
}

export async function fetchAutoPublishAccountsStatus(workspace: string): Promise<AutoPublishStatus[]> {
  return getAutoPublishStatusForAllAccounts(workspace);
}

/** 자동발행 ON/OFF 토글 */
export async function toggleAutoPublish(
  workspace: string,
  accountId: string,
  enabled: boolean,
) {
  const state = enabled
    ? await enableAutoPublish(workspace, accountId)
    : await disableAutoPublish(workspace, accountId);

  const status = await getAutoPublishStatus(workspace, accountId);
  const accounts_status =
    workspace === 'yeonun' ? await getAutoPublishStatusForAllAccounts(workspace) : undefined;

  return {
    enabled: state.enabled,
    planned_count: state.planned_count,
    remaining_today: state.remaining_today,
    next_slot_at: state.next_slot_at,
    status,
    accounts_status,
  };
}

export async function setAutoPublish(workspace: string, accountId: string | undefined, enabled: boolean) {
  const trimmed = accountId?.trim();
  if (workspace === 'yeonun' && !trimmed) {
    throw new Error('연운 자동발행은 계정을 선택하세요');
  }
  const targetId = trimmed ?? (await resolvePostingAccount(workspace))?.id;
  if (!targetId) throw new Error('포스팅 계정 없음');
  return setAutoPublishEnabled(workspace, targetId, enabled);
}
