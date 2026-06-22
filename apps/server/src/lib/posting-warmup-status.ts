import { POSTING_DONGLE_SLOTS } from '@huma/shared';
import { supabase } from '../middleware/auth.js';
import { formatPostingAccountLabel } from './posting-accounts.js';
import { getDailyPostingTarget } from './posting-daily-target.js';
import { describePostingWarmupPhase, getPostingWarmupWeekdayCap } from './posting-warmup.js';

export interface PostingWarmupStatusRow {
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

/** 연운1~3 · 퀴즈 · 파나나 포스팅 계정 워밍업 현황 */
export async function fetchPostingWarmupStatus(): Promise<PostingWarmupStatusRow[]> {
  const rows: PostingWarmupStatusRow[] = [];

  for (const slot of POSTING_DONGLE_SLOTS) {
    const { data: acc } = await supabase
      .from('huma_accounts')
      .select('id, warmup_day, slot_label, name')
      .eq('workspace', slot.workspace)
      .eq('account_type', 'posting')
      .eq('is_active', true)
      .eq('proxy_port', slot.proxyPort)
      .maybeSingle();

    const slotLabel = slot.label;

    if (!acc?.id) {
      rows.push({
        slot_label: slotLabel,
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

    const accountId = acc.id as string;
    const warmupDay = (acc.warmup_day as number | undefined) ?? 0;
    const phase = describePostingWarmupPhase(warmupDay);
    const cap = getPostingWarmupWeekdayCap(warmupDay);
    const targetInfo = getDailyPostingTarget(accountId, new Date(), { warmupDay });

    rows.push({
      slot_label: formatPostingAccountLabel(acc) ?? slotLabel,
      workspace: slot.workspace,
      proxy_port: slot.proxyPort,
      account_id: accountId,
      warmup_day: warmupDay,
      phase_label: phase.label,
      stage: phase.stage,
      weekday_cap: cap >= 999 ? null : cap,
      today_target: targetInfo.target,
      is_complete: cap >= 999,
      missing: false,
    });
  }

  return rows;
}
