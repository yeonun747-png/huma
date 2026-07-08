import { POSTING_DONGLE_SLOTS } from '@huma/shared';
import { supabase } from '../middleware/auth.js';
import { formatPostingAccountLabel } from './posting-accounts.js';
import { getDailyPostingTarget } from './posting-daily-target.js';
import { reconcilePostingWarmupDay } from './posting-warmup-day.js';
import { describePostingWarmupPhase, resolvePostingWeekdayCapDisplay } from './posting-warmup.js';

export interface PostingWarmupStatusRow {
  dongle_label: string;
  slot_label: string;
  workspace: string;
  proxy_port: number;
  account_id: string | null;
  warmup_day: number;
  phase_label: string;
  stage: string;
  weekday_cap: number | null;
  today_target: number | null;
  is_complete: boolean;
  missing: boolean;
}

async function buildAccountWarmupRow(
  dongleLabel: string,
  account: {
    id: string;
    warmup_day?: number | null;
    slot_label?: string | null;
    name?: string | null;
  },
  slot: { workspace: string; proxyPort: number },
): Promise<PostingWarmupStatusRow> {
  const accountId = account.id as string;
  const warmupDay = await reconcilePostingWarmupDay(accountId);
  const phase = describePostingWarmupPhase(warmupDay);
  const weekdayCapDisplay = resolvePostingWeekdayCapDisplay(warmupDay);
  const targetInfo = getDailyPostingTarget(accountId, new Date(), { warmupDay });
  const todayTarget = targetInfo.is_weekend
    ? targetInfo.target
    : Math.min(targetInfo.target, weekdayCapDisplay);

  return {
    dongle_label: dongleLabel,
    slot_label: formatPostingAccountLabel(account) ?? dongleLabel,
    workspace: slot.workspace,
    proxy_port: slot.proxyPort,
    account_id: accountId,
    warmup_day: warmupDay,
    phase_label: phase.label,
    stage: phase.stage,
    weekday_cap: weekdayCapDisplay,
    today_target: todayTarget,
    is_complete: phase.stage === 'complete',
    missing: false,
  };
}

/** 포스팅 동글·계정별 워밍업 현황 — allowedWorkspaces에 해당하는 슬롯만 */
export async function fetchPostingWarmupStatus(
  allowedWorkspaces: string[],
): Promise<PostingWarmupStatusRow[]> {
  const allowed = new Set(allowedWorkspaces);
  const slots = POSTING_DONGLE_SLOTS.filter((s) => allowed.has(s.workspace));
  const rows: PostingWarmupStatusRow[] = [];

  for (const slot of slots) {
    const { data: accRows } = await supabase
      .from('huma_accounts')
      .select('id, warmup_day, slot_label, name')
      .eq('workspace', slot.workspace)
      .eq('account_type', 'posting')
      .eq('is_active', true)
      .eq('proxy_port', slot.proxyPort)
      .order('slot_label', { ascending: true });

    const accounts = accRows ?? [];

    if (!accounts.length) {
      rows.push({
        dongle_label: slot.label,
        slot_label: slot.label,
        workspace: slot.workspace,
        proxy_port: slot.proxyPort,
        account_id: null,
        warmup_day: 0,
        phase_label: '계정 없음',
        stage: 'missing',
        weekday_cap: null,
        today_target: null,
        is_complete: false,
        missing: true,
      });
      continue;
    }

    for (const acc of accounts) {
      rows.push(await buildAccountWarmupRow(slot.label, acc, slot));
    }
  }

  return rows;
}
