import { supabase } from '../middleware/auth.js';

import { getPostingEnabled } from './activity-control.js';

import { getEffectiveDailyLimit, getNightBanBlockMessage, isNightBanActive } from './human-engine-policy.js';

import { isWeekendKst } from './posting-schedule.js';

import { formatKstDateKey, getDailyPostingTarget } from './posting-daily-target.js';

import {
  listAllPostingAccountsForWorkspace,
  listPostingAccounts,
  loadPostingAccountById,
  pickPostingAccount,
} from './posting-accounts.js';
import { postingSlotByWorkspace } from './dongle-slots.js';

import { listActiveQuizContent } from '../modules/video-content/quiz-content-cache.js';

import { listActivePananaCharacters } from '../modules/video-content/panana-characters.js';

import { listYeonunProducts } from '../modules/video-content/yeonun-product-picker.js';

import { getPostingReservedToday, isOrphanPostingReservation, clearOrphanPostingReservations } from './posting-quota-reserve.js';
import { countTodaySimilaritySkipped } from './posting-content-similarity.js';
import { countTodayPostBlogPublished } from './post-blog-publish-day.js';
import { getPostingWarmupDay } from './posting-warmup-day.js';
import { resolveAutoPublishPlannedCountForDay } from './auto-publish-slot-planner.js';



export type AutoPublishBlockReason =

  | 'POSTING_DISABLED'

  | 'NIGHT_BAN'

  | 'QUOTA'

  | 'HARD_CAP'

  | 'CACHE_EMPTY'

  | 'NO_ACCOUNT'

  | 'IN_FLIGHT'

  | 'INACTIVE';



export interface AutoPublishStatus {

  workspace: string;

  account_id?: string;

  account_label?: string;

  today_completed: number;

  /** 오늘 유사도 스킵된 content_full 건수 */
  today_skipped: number;

  daily_target: number;

  weekday_base: number;

  remaining: number;

  hard_cap: number;

  can_publish: boolean;

  block_reason?: AutoPublishBlockReason;

  block_message?: string;

  auto_pick_ready: boolean;

  is_weekend: boolean;

  weekend_ratio?: number;

  warmup_cap?: number;

  in_flight?: number;

  /** DB 자동발행 ON/OFF */
  auto_publish_enabled?: boolean;

  /** 당일 고정 계획 건수 (켜는 날 확정) */
  auto_publish_planned_count?: number | null;

  /** 다음 content_full 자동 등록 예정 */
  auto_publish_next_slot_at?: string | null;

  /** 포스팅 동글 proxy_port (10001~10005) */
  proxy_port?: number | null;

  /** 이 계정 큐에 예약된 다음 content_full/post_blog 시각 */
  next_queued_at?: string | null;

  is_active?: boolean;

}



/** KST 오늘 00:00 UTC ISO */

export function kstTodayStartIso(date = new Date()): string {

  const key = formatKstDateKey(date);

  return new Date(`${key}T00:00:00+09:00`).toISOString();

}



export async function countTodayPostBlogCompleted(accountId: string): Promise<number> {
  return countTodayPostBlogPublished(accountId);
}



export async function countInFlightPostingPipeline(
  accountId: string,
  opts?: { excludeJobId?: string },
): Promise<number> {

  const key = accountId.trim();

  if (!key) return 0;

  const since = kstTodayStartIso();

  const excludeId = opts?.excludeJobId?.trim();



  let contentQuery = supabase

    .from('huma_jobs')

    .select('*', { count: 'exact', head: true })

    .eq('account_id', key)

    .eq('job_type', 'content_full')

    .in('status', ['pending', 'scheduled', 'running'])

    .gte('created_at', since);

  if (excludeId) contentQuery = contentQuery.neq('id', excludeId);



  let blogQuery = supabase

    .from('huma_jobs')

    .select('*', { count: 'exact', head: true })

    .eq('account_id', key)

    .eq('job_type', 'post_blog')

    .in('status', ['pending', 'scheduled', 'running', 'awaiting_captcha'])

    .gte('created_at', since);

  if (excludeId) blogQuery = blogQuery.neq('id', excludeId);



  const [contentRes, blogRes] = await Promise.all([contentQuery, blogQuery]);



  if (contentRes.error) throw new Error(`파이프라인 집계 실패: ${contentRes.error.message}`);

  if (blogRes.error) throw new Error(`발행 대기 집계 실패: ${blogRes.error.message}`);



  return (contentRes.count ?? 0) + (blogRes.count ?? 0);

}



export async function isAutoPickReady(workspace: string): Promise<boolean> {

  if (workspace === 'yeonun') {

    const products = await listYeonunProducts();

    return products.length > 0;

  }

  if (workspace === 'quizoasis') {

    const quizzes = await listActiveQuizContent();

    return quizzes.length > 0;

  }

  if (workspace === 'panana') {

    const chars = await listActivePananaCharacters();

    return chars.length > 0;

  }

  return false;

}



async function resolvePostingAccountForStatus(workspace: string, accountId?: string) {

  if (accountId?.trim()) {

    return loadPostingAccountById(accountId.trim());

  }

  return pickPostingAccount(workspace, { advance: false });

}



async function fetchNextQueuedAtByAccountIds(
  accountIds: string[],
): Promise<Map<string, string>> {
  if (!accountIds.length) return new Map();

  const nowIso = new Date().toISOString();
  const map = new Map<string, string>();

  const { data: scheduledRows } = await supabase
    .from('huma_jobs')
    .select('account_id, scheduled_at')
    .in('account_id', accountIds)
    .in('job_type', ['content_full', 'post_blog'])
    .in('status', ['pending', 'scheduled'])
    .not('scheduled_at', 'is', null)
    .gt('scheduled_at', nowIso)
    .order('scheduled_at', { ascending: true });

  for (const row of scheduledRows ?? []) {
    const id = row.account_id as string | null;
    if (!id || map.has(id)) continue;
    map.set(id, String(row.scheduled_at));
  }

  const { data: immediateRows } = await supabase
    .from('huma_jobs')
    .select('account_id, created_at')
    .in('account_id', accountIds)
    .in('job_type', ['content_full', 'post_blog'])
    .in('status', ['pending', 'scheduled', 'running', 'awaiting_captcha'])
    .or(`scheduled_at.is.null,scheduled_at.lte.${nowIso}`);

  for (const row of immediateRows ?? []) {
    const id = row.account_id as string | null;
    if (!id || map.has(id)) continue;
    map.set(id, String(row.created_at ?? nowIso));
  }

  return map;
}



async function buildAccountPublishStatus(

  workspace: string,

  account: {
    id: string;
    label?: string;
    proxy_port?: number | null;
    next_queued_at?: string | null;
    is_active?: boolean;
  },

): Promise<AutoPublishStatus> {

  const auto_pick_ready = await isAutoPickReady(workspace);

  const is_weekend = isWeekendKst();

  const hard_cap = await getEffectiveDailyLimit('post_blog');



  const { data: accRow } = await supabase

    .from('huma_accounts')

    .select('warmup_day, auto_publish_enabled, auto_publish_kst_date, auto_publish_planned_count, auto_publish_next_slot_at, proxy_port, is_active')

    .eq('id', account.id)

    .maybeSingle();

  const warmupDay = await getPostingWarmupDay(account.id);

  const targetInfo = getDailyPostingTarget(account.id, new Date(), { warmupDay });

  const today_completed = await countTodayPostBlogCompleted(account.id);

  const today_skipped = await countTodaySimilaritySkipped(account.id, kstTodayStartIso());

  const pipeline_jobs = await countInFlightPostingPipeline(account.id);

  let reserved_slots = await getPostingReservedToday(account.id);
  if (isOrphanPostingReservation(pipeline_jobs, reserved_slots)) {
    await clearOrphanPostingReservations(account.id, pipeline_jobs).catch(() => undefined);
    reserved_slots = 0;
  }

  const in_flight = pipeline_jobs + reserved_slots;

  const daily_target = targetInfo.target;

  const remaining = Math.max(0, daily_target - today_completed - today_skipped - in_flight);

  const storedPlanned = (accRow?.auto_publish_planned_count as number | null) ?? null;
  const storedKstDate = (accRow?.auto_publish_kst_date as string | null) ?? null;
  let auto_publish_planned_count = storedPlanned;
  if (storedPlanned != null) {
    auto_publish_planned_count = await resolveAutoPublishPlannedCountForDay(
      account.id,
      storedKstDate,
      storedPlanned,
    );
    if (
      Boolean(accRow?.auto_publish_enabled) &&
      storedKstDate === formatKstDateKey() &&
      auto_publish_planned_count !== storedPlanned
    ) {
      await supabase
        .from('huma_accounts')
        .update({ auto_publish_planned_count })
        .eq('id', account.id);
    }
  }

  let auto_publish_next_slot_at = (accRow?.auto_publish_next_slot_at as string | null) ?? null;
  if (Boolean(accRow?.auto_publish_enabled) && !auto_publish_next_slot_at) {
    const plannedForEnsure =
      auto_publish_planned_count ?? daily_target;
    const consumedForEnsure = today_completed + today_skipped + in_flight;
    if (plannedForEnsure > 0 && consumedForEnsure < plannedForEnsure) {
      const { ensureAutoPublishNextSlot } = await import('./auto-publish-state.js');
      auto_publish_next_slot_at =
        (await ensureAutoPublishNextSlot(account.id, workspace).catch(() => null)) ??
        auto_publish_next_slot_at;
    }
  }

  const base: AutoPublishStatus = {

    workspace,

    account_id: account.id,

    account_label: account.label,

    today_completed,

    today_skipped,

    daily_target,

    weekday_base: targetInfo.weekday_base,

    remaining,

    hard_cap,

    can_publish: false,

    auto_pick_ready,

    is_weekend,

    weekend_ratio: targetInfo.weekend_ratio,

    warmup_cap: targetInfo.warmup_cap,

    in_flight,

    auto_publish_enabled: Boolean(accRow?.auto_publish_enabled),

    auto_publish_planned_count,

    auto_publish_next_slot_at,

    proxy_port:
      account.proxy_port ??
      (typeof accRow?.proxy_port === 'number' ? (accRow.proxy_port as number) : null) ??
      postingSlotByWorkspace(workspace)?.proxyPort ??
      null,

    next_queued_at: account.next_queued_at ?? null,

    is_active: account.is_active ?? Boolean(accRow?.is_active),

  };



  if (base.is_active === false) {

    return {

      ...base,

      block_reason: 'INACTIVE',

      block_message: '계정 비활성 — 계정 관리에서 활성화하세요',

    };

  }



  if (!getPostingEnabled()) {

    return {

      ...base,

      block_reason: 'POSTING_DISABLED',

      block_message: '포스팅 활동이 OFF입니다 — 설정에서 활성화하세요',

    };

  }



  if (await isNightBanActive()) {

    return {

      ...base,

      block_reason: 'NIGHT_BAN',

      block_message: await getNightBanBlockMessage(),

    };

  }



  if (!auto_pick_ready) {

    return {

      ...base,

      block_reason: 'CACHE_EMPTY',

      block_message:

        workspace === 'yeonun'

          ? '연운 상품 데이터 없음'

          : workspace === 'quizoasis'

            ? '퀴즈 캐시 없음 — 계정관리에서 동기화'

            : '파나나 캐릭터 캐시 없음 — 계정관리에서 동기화',

    };

  }



  if (today_completed >= hard_cap) {

    return {

      ...base,

      block_reason: 'HARD_CAP',

      block_message: `계정 안전 상한 도달 (${hard_cap}건/일)`,

    };

  }



  if (remaining <= 0) {

    const reason = in_flight > 0 ? 'IN_FLIGHT' : 'QUOTA';

    return {

      ...base,

      block_reason: reason,

      block_message:

        in_flight > 0

          ? `이 계정 파이프라인 처리 중 (${in_flight}건) · 목표 ${daily_target}건`

          : `이 계정 오늘 목표 도달 (${today_completed}/${daily_target}건${today_skipped > 0 ? ` · 스킵 ${today_skipped}건` : ''})`,

    };

  }



  return { ...base, can_publish: true };

}



export async function getAutoPublishStatus(

  workspace: string,

  accountId?: string,

): Promise<AutoPublishStatus> {

  const account = await resolvePostingAccountForStatus(workspace, accountId);

  const auto_pick_ready = await isAutoPickReady(workspace);

  const is_weekend = isWeekendKst();

  const hard_cap = await getEffectiveDailyLimit('post_blog');



  if (!account?.id) {

    return {

      workspace,

      today_completed: 0,

      today_skipped: 0,

      daily_target: 0,

      auto_publish_enabled: false,

      auto_publish_planned_count: null,

      auto_publish_next_slot_at: null,

      weekday_base: 3,

      remaining: 0,

      hard_cap,

      can_publish: false,

      auto_pick_ready,

      is_weekend,

      block_reason: 'NO_ACCOUNT',

      block_message: '활성 포스팅 계정 없음',

    };

  }



  return buildAccountPublishStatus(workspace, account);

}



export async function getAutoPublishButtonStatus(workspace: string): Promise<AutoPublishStatus> {

  const accounts = await listPostingAccounts(workspace);

  if (accounts.length <= 1) {
    const picked = await pickPostingAccount(workspace, { advance: false });
    return getAutoPublishStatus(workspace, picked?.id ?? accounts[0]?.id);
  }



  const all = await Promise.all(

    accounts.map((a) => buildAccountPublishStatus(workspace, { id: a.id, label: a.label })),

  );

  const next = await pickPostingAccount(workspace, { advance: false });

  const primary = all.find((s) => s.account_id === next?.id) ?? all[0]!;

  const anyCan = all.some((s) => s.can_publish);
  const anyAutoOn = all.some((s) => s.auto_publish_enabled);

  if (!anyCan && !anyAutoOn) return primary;

  if (primary.can_publish || primary.auto_publish_enabled) return primary;

  const fallback = all.find((s) => s.can_publish || s.auto_publish_enabled);
  return fallback ?? primary;
}



export async function getAutoPublishStatusForAllAccounts(

  workspace: string,

): Promise<AutoPublishStatus[]> {

  const accounts = await listAllPostingAccountsForWorkspace(workspace);

  if (!accounts.length) return [];

  const nextQueuedByAccount = await fetchNextQueuedAtByAccountIds(accounts.map((a) => a.id));

  const rows = await Promise.all(

    accounts.map((a) =>
      buildAccountPublishStatus(workspace, {
        id: a.id,
        label: a.label,
        proxy_port: a.proxy_port,
        next_queued_at: nextQueuedByAccount.get(a.id) ?? null,
      }),
    ),

  );

  return rows.sort((a, b) => {
    const pa = a.proxy_port ?? 99999;
    const pb = b.proxy_port ?? 99999;
    if (pa !== pb) return pa - pb;
    return (a.account_label ?? '').localeCompare(b.account_label ?? '', 'ko');
  });

}



export async function assertAccountPostingQuota(

  workspace: string,

  accountId: string,

  opts?: { excludeJobId?: string },

): Promise<void> {

  const status = await getAutoPublishStatus(workspace, accountId);

  if (status.can_publish) return;



  const excludeJobId = opts?.excludeJobId?.trim();

  if (excludeJobId) {

    const pipeline_jobs = await countInFlightPostingPipeline(accountId, { excludeJobId });

    const reserved_slots = await getPostingReservedToday(accountId);

    if (

      !isPostingQuotaOvercommitted(

        status.today_completed,

        pipeline_jobs,

        reserved_slots,

        status.daily_target,

        status.today_skipped,

      )

    ) {

      return;

    }

  }



  throw new Error(status.block_message ?? '오늘 발행 한도에 도달했습니다');

}



/** 파이프라인+예약+스킵이 일일 목표를 초과하는지 (실행 중 job 포함) */
export function isPostingQuotaOvercommitted(
  todayCompleted: number,
  pipelineJobs: number,
  reservedSlots: number,
  dailyTarget: number,
  todaySkipped = 0,
): boolean {
  return todayCompleted + pipelineJobs + reservedSlots + todaySkipped > dailyTarget;
}



/** content_full 실행 직전(LLM·Imagen 전) — 파이프라인 초과 시 AI 비용 차단 */

export async function assertAccountPostingQuotaBeforeGeneration(

  workspace: string,

  accountId: string,

  excludeJobId?: string,

): Promise<void> {

  const status = await getAutoPublishStatus(workspace, accountId);

  const hard_cap = await getEffectiveDailyLimit('post_blog');



  if (!getPostingEnabled()) {

    throw new Error('포스팅 활동이 OFF입니다 — 설정에서 활성화하세요');

  }



  if (await isNightBanActive()) {

    throw new Error(await getNightBanBlockMessage());

  }



  if (status.today_completed >= hard_cap) {

    throw new Error(`계정 안전 상한 도달 (${hard_cap}건/일)`);

  }



  const pipeline_jobs = await countInFlightPostingPipeline(accountId, {
    excludeJobId: excludeJobId?.trim() || undefined,
  });

  const reserved_slots = await getPostingReservedToday(accountId);



  if (
    isPostingQuotaOvercommitted(
      status.today_completed,
      pipeline_jobs,
      reserved_slots,
      status.daily_target,
      status.today_skipped,
    )
  ) {

    throw new Error(

      status.block_message ??

        `이 계정 오늘 목표 초과 (${status.today_completed}/${status.daily_target}건 · 파이프라인 ${pipeline_jobs}건)`,

    );

  }

}



export async function assertWorkspacePostingQuota(workspace: string): Promise<void> {

  const account = await pickPostingAccount(workspace, { advance: false });

  if (!account?.id) throw new Error('활성 포스팅 계정 없음');

  await assertAccountPostingQuota(workspace, account.id);

}


