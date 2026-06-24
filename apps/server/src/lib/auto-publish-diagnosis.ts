import { supabase } from '../middleware/auth.js';
import { loadAutoPublishAccountState } from './auto-publish-state.js';
import {
  countAutoPublishConsumedToday,
} from './auto-publish-slot-planner.js';
import {
  countInFlightPostingPipeline,
  getAutoPublishStatus,
  kstTodayStartIso,
} from './posting-daily-status.js';
import {
  getPostingReservedToday,
  isOrphanPostingReservation,
} from './posting-quota-reserve.js';
import { explainPostBlogPublishDay } from './post-blog-publish-day.js';

export interface AutoPublishInflightJobRow {
  id: string;
  job_type: string;
  status: string;
  title: string | null;
  created_at: string;
  scheduled_at: string | null;
  error_message: string | null;
  auto_publish: boolean;
}

export interface AutoPublishAccountDiagnosis {
  account_id: string;
  label: string | null;
  proxy_port: number | null;
  warmup_day: number;
  auto_publish_enabled: boolean;
  auto_publish_next_slot_at: string | null;
  auto_publish_planned_count: number | null;
  posting_reserved_today: number;
  posting_reserved_kst_date: string | null;
  pipeline_jobs: number;
  reserved_slots: number;
  orphan_reservation: boolean;
  consumed_today: number;
  publish_status: Awaited<ReturnType<typeof getAutoPublishStatus>>;
  publish_day: Awaited<ReturnType<typeof explainPostBlogPublishDay>>;
  inflight_jobs: AutoPublishInflightJobRow[];
}

async function loadAccountMeta(accountId: string) {
  const { data } = await supabase
    .from('huma_accounts')
    .select(
      'slot_label, name, proxy_port, warmup_day, auto_publish_enabled, auto_publish_next_slot_at, auto_publish_planned_count, posting_reserved_today, posting_reserved_kst_date',
    )
    .eq('id', accountId)
    .maybeSingle();
  return data;
}

export async function diagnoseAutoPublishAccount(
  workspace: string,
  accountId: string,
): Promise<AutoPublishAccountDiagnosis> {
  const key = accountId.trim();
  const since = kstTodayStartIso();
  const [meta, pipelineJobs, reservedSlots, publishStatus, publishDay, consumed, state] =
    await Promise.all([
      loadAccountMeta(key),
      countInFlightPostingPipeline(key),
      getPostingReservedToday(key),
      getAutoPublishStatus(workspace, key),
      explainPostBlogPublishDay(key),
      countAutoPublishConsumedToday(key),
      loadAutoPublishAccountState(key),
    ]);

  const { data: inflightRaw } = await supabase
    .from('huma_jobs')
    .select('id, job_type, status, title, created_at, scheduled_at, error_message, platform_schedule')
    .eq('account_id', key)
    .gte('created_at', since)
    .in('status', ['pending', 'scheduled', 'running', 'awaiting_captcha'])
    .order('created_at', { ascending: false })
    .limit(20);

  const inflight_jobs: AutoPublishInflightJobRow[] = (inflightRaw ?? []).map((row) => {
    const ps = (row.platform_schedule as Record<string, unknown> | null) ?? {};
    return {
      id: row.id as string,
      job_type: row.job_type as string,
      status: row.status as string,
      title: (row.title as string | null) ?? null,
      created_at: row.created_at as string,
      scheduled_at: (row.scheduled_at as string | null) ?? null,
      error_message: (row.error_message as string | null) ?? null,
      auto_publish: ps._auto_publish === true,
    };
  });

  return {
    account_id: key,
    label: (meta?.slot_label as string | null) ?? (meta?.name as string | null) ?? state?.label ?? null,
    proxy_port: (meta?.proxy_port as number | null) ?? null,
    warmup_day: (meta?.warmup_day as number | undefined) ?? 0,
    auto_publish_enabled: Boolean(meta?.auto_publish_enabled),
    auto_publish_next_slot_at:
      (meta?.auto_publish_next_slot_at as string | null) ?? state?.next_slot_at ?? null,
    auto_publish_planned_count:
      (meta?.auto_publish_planned_count as number | null) ?? state?.planned_count ?? null,
    posting_reserved_today: (meta?.posting_reserved_today as number | undefined) ?? 0,
    posting_reserved_kst_date: (meta?.posting_reserved_kst_date as string | null) ?? null,
    pipeline_jobs: pipelineJobs,
    reserved_slots: reservedSlots,
    orphan_reservation: isOrphanPostingReservation(pipelineJobs, reservedSlots),
    consumed_today: consumed,
    publish_status: publishStatus,
    publish_day: publishDay,
    inflight_jobs,
  };
}

export async function diagnoseAutoPublishWorkspace(
  workspace: string,
  slotLabels?: string[],
): Promise<AutoPublishAccountDiagnosis[]> {
  let query = supabase
    .from('huma_accounts')
    .select('id, slot_label, proxy_port')
    .eq('workspace', workspace)
    .eq('account_type', 'posting')
    .eq('is_active', true)
    .order('proxy_port', { ascending: true });

  if (slotLabels?.length) {
    query = query.in('slot_label', slotLabels);
  }

  const { data: accounts } = await query;
  const rows: AutoPublishAccountDiagnosis[] = [];
  for (const acc of accounts ?? []) {
    rows.push(await diagnoseAutoPublishAccount(workspace, acc.id as string));
  }
  return rows;
}
