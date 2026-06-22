import { registerAutoContentJobs } from '../claude/auto-content-orchestrator.js';
import {
  getAutoPublishButtonStatus,
  getAutoPublishStatus,
  getAutoPublishStatusForAllAccounts,
  type AutoPublishStatus,
} from '../../lib/posting-daily-status.js';

export async function fetchAutoPublishStatus(workspace: string): Promise<AutoPublishStatus> {
  return getAutoPublishButtonStatus(workspace);
}

export async function fetchAutoPublishAccountsStatus(workspace: string): Promise<AutoPublishStatus[]> {
  return getAutoPublishStatusForAllAccounts(workspace);
}

export async function runAutoPublish(workspace: string, accountId?: string) {
  const trimmedAccountId = accountId?.trim();

  if (workspace === 'yeonun') {
    if (!trimmedAccountId) {
      throw new Error('연운 자동 발행은 계정을 선택하세요');
    }
    const accountStatus = await getAutoPublishStatus(workspace, trimmedAccountId);
    if (!accountStatus.can_publish) {
      throw new Error(accountStatus.block_message ?? '자동 발행 불가');
    }
  } else {
    const buttonStatus = await getAutoPublishButtonStatus(workspace);
    if (!buttonStatus.can_publish) {
      throw new Error(buttonStatus.block_message ?? '자동 발행 불가');
    }
  }

  const result = await registerAutoContentJobs({
    workspace,
    account_id: trimmedAccountId,
    auto_schedule: true,
    content_type_auto: true,
  });

  const resolvedAccountId = (result.primary_job.account_id as string | undefined) ?? trimmedAccountId;
  const status = await getAutoPublishStatus(workspace, resolvedAccountId);
  const accounts_status =
    workspace === 'yeonun' ? await getAutoPublishStatusForAllAccounts(workspace) : undefined;

  return {
    job: result.primary_job,
    auto_picked: result.auto_picked,
    auto_pick_label: result.auto_pick_label,
    title: result.primary_job.title,
    link_url: result.primary_job.link_url,
    status,
    accounts_status,
  };
}
