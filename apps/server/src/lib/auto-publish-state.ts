import { supabase } from '../middleware/auth.js';
import { formatKstDateKey } from './posting-daily-target.js';
import { getPostingEnabled } from './activity-control.js';
import { isNightBanActive } from './human-engine-policy.js';
import { logOperation } from './log-emitter.js';
import { listPostingAccounts } from './posting-accounts.js';
import {
  countAutoPublishConsumedToday,
  planNextAutoPublishTriggerAt,
  resolveAutoPublishPlannedCountForDay,
} from './auto-publish-slot-planner.js';
import {
  countInFlightPostingPipeline,
  getAutoPublishStatus,
  kstTodayStartIso,
} from './posting-daily-status.js';
import {
  clearOrphanPostingReservations,
  getPostingReservedToday,
  isOrphanPostingReservation,
  resetPostingQuotaReservation,
  reservePostingQuotaSlot,
  releasePostingQuotaSlot,
} from './posting-quota-reserve.js';
import { postingSlotByWorkspace } from './dongle-slots.js';
import { randomBetween } from './utils.js';

/** 동시 tick이 같은 계정 due 슬롯을 중복 처리하지 않도록 (DB next_slot_at은 건드리지 않음) */
const autoPublishDueProcessing = new Set<string>();

/** 파이프라인 처리 중 — 최소 간격 재계산 없이 짧게 재시도 */
export function deferAutoPublishRetryIso(minMinutes = 2, maxMinutes = 4): string {
  return new Date(Date.now() + randomBetween(minMinutes, maxMinutes) * 60_000).toISOString();
}

const SHORT_SLOT_CLAIM_MS = 5 * 60_000;

function isRecentDueRetrySlot(at: string | null | undefined, now = Date.now()): boolean {
  if (!at) return false;
  const ms = new Date(at).getTime();
  return ms >= now - SHORT_SLOT_CLAIM_MS && ms <= now + SHORT_SLOT_CLAIM_MS;
}

/**
 * 미래에 잡힌 다음 슬롯을 더 늦은 시각으로 밀지 않음.
 * due 처리 직후 짧은 클레임(2~4분) 구간은 정상 다음 슬롯으로 교체 허용.
 */
export function coalesceAutoPublishNextSlot(
  existing: string | null | undefined,
  proposed: string | null,
  now = Date.now(),
): string | null {
  if (proposed == null) return null;
  if (!existing) return proposed;

  const existingMs = new Date(existing).getTime();
  const proposedMs = new Date(proposed).getTime();
  if (existingMs <= now + 60_000) return proposed;

  const isShortClaim = existingMs <= now + SHORT_SLOT_CLAIM_MS;
  if (isShortClaim) return proposed;
  if (proposedMs > existingMs) return existing;
  return proposed;
}

function isFutureAutoPublishSlot(at: string | null | undefined, now = Date.now()): boolean {
  if (!at) return false;
  return new Date(at).getTime() > now + 60_000;
}

export async function resolveBlockedAutoPublishNextSlot(
  publishStatus: Awaited<ReturnType<typeof getAutoPublishStatus>>,
  input: { accountId: string; plannedCount: number; consumedCount: number },
  dueSlotAt?: string | null,
): Promise<string | null> {
  const reason = publishStatus.block_reason;
  if (reason === 'IN_FLIGHT') {
    return deferAutoPublishRetryIso();
  }
  if (reason === 'QUOTA') {
    // 일일 post_blog 목표 도달 — 당일 재시도해도 열리지 않음 (planned>daily_target 잔존 시 무한 defer 방지)
    return null;
  }
  if (reason === 'HARD_CAP') return null;
  if (reason === 'CACHE_EMPTY' || reason === 'POSTING_DISABLED') {
    return new Date(Date.now() + 15 * 60_000).toISOString();
  }
  // due 슬롯이 막혔을 때 전체 재계산은 슬롯을 멀리 밀 수 있음 — 짧은 재시도 우선
  if (dueSlotAt && new Date(dueSlotAt).getTime() <= Date.now() + 60_000) {
    return deferAutoPublishRetryIso(3, 8);
  }
  return planNextAutoPublishTriggerAt({
    accountId: input.accountId,
    plannedCount: input.plannedCount,
    consumedCount: input.consumedCount,
  });
}

export interface AutoPublishAccountState {
  id: string;
  workspace: string;
  label?: string;
  enabled: boolean;
  kst_date: string | null;
  planned_count: number | null;
  next_slot_at: string | null;
  consumed_today: number;
  remaining_today: number;
}

export function isAutoPublishJob(platformSchedule: unknown): boolean {
  if (!platformSchedule || typeof platformSchedule !== 'object') return false;
  return (platformSchedule as Record<string, unknown>)._auto_publish === true;
}

export async function loadAutoPublishAccountState(accountId: string): Promise<AutoPublishAccountState | null> {
  const { data, error } = await supabase
    .from('huma_accounts')
    .select(
      'id, workspace, name, slot_label, auto_publish_enabled, auto_publish_kst_date, auto_publish_planned_count, auto_publish_next_slot_at',
    )
    .eq('id', accountId)
    .maybeSingle();

  if (error || !data) return null;

  const consumed = await countAutoPublishConsumedToday(accountId);
  const kstDate = formatKstDateKey();
  const planned = await resolveAutoPublishPlannedCountForDay(
    accountId,
    (data.auto_publish_kst_date as string | null) ?? null,
    data.auto_publish_planned_count as number | null,
  );
  const remaining = Math.max(0, planned - consumed);

  return {
    id: data.id as string,
    workspace: data.workspace as string,
    label: (data.slot_label as string | null) ?? (data.name as string | null) ?? undefined,
    enabled: Boolean(data.auto_publish_enabled),
    kst_date: (data.auto_publish_kst_date as string | null) ?? null,
    planned_count: planned,
    next_slot_at: (data.auto_publish_next_slot_at as string | null) ?? null,
    consumed_today: consumed,
    remaining_today: remaining,
  };
}

/** 자동발행 OFF — 당일 자동발행 job·고아 예약 정리 */
async function cancelAutoPublishJobsOnDisable(
  accountId: string,
): Promise<{ content: number; blog: number }> {
  const since = kstTodayStartIso();
  let content = 0;
  let blog = 0;

  const specs = [
    {
      jobType: 'content_full' as const,
      statuses: ['pending', 'scheduled', 'running'],
    },
    {
      jobType: 'post_blog' as const,
      statuses: ['pending', 'scheduled', 'running', 'awaiting_captcha'],
    },
  ];

  for (const spec of specs) {
    const { data: rows } = await supabase
      .from('huma_jobs')
      .select('id, platform_schedule')
      .eq('account_id', accountId)
      .eq('job_type', spec.jobType)
      .in('status', spec.statuses)
      .gte('created_at', since);

    const ids = (rows ?? [])
      .filter((r) => isAutoPublishJob(r.platform_schedule))
      .map((r) => r.id as string);

    if (!ids.length) continue;

    await supabase
      .from('huma_jobs')
      .update({
        status: 'failed',
        error_message: '자동발행 OFF — 대기·처리 중 작업 취소',
      })
      .in('id', ids);

    if (spec.jobType === 'content_full') content = ids.length;
    else blog = ids.length;
  }

  return { content, blog };
}

async function persistAutoPublishPlan(
  accountId: string,
  patch: {
    enabled: boolean;
    kst_date: string;
    planned_count: number;
    next_slot_at: string | null;
  },
  opts?: { replaceSlot?: boolean },
): Promise<void> {
  let nextSlotAt = patch.next_slot_at;
  if (nextSlotAt != null && !opts?.replaceSlot) {
    const { data: row } = await supabase
      .from('huma_accounts')
      .select('auto_publish_next_slot_at')
      .eq('id', accountId)
      .maybeSingle();
    nextSlotAt = coalesceAutoPublishNextSlot(
      (row?.auto_publish_next_slot_at as string | null) ?? null,
      nextSlotAt,
    );
  }

  const { error } = await supabase
    .from('huma_accounts')
    .update({
      auto_publish_enabled: patch.enabled,
      auto_publish_kst_date: patch.kst_date,
      auto_publish_planned_count: patch.planned_count,
      auto_publish_next_slot_at: nextSlotAt,
    })
    .eq('id', accountId);

  if (error) throw new Error(`자동발행 상태 저장 실패: ${error.message}`);
}

/** 자동발행 ON — 당일 계획 건수 고정·다음 슬롯 예약 */
export async function enableAutoPublish(workspace: string, accountId: string): Promise<AutoPublishAccountState> {
  if (!getPostingEnabled()) {
    throw new Error('포스팅 활동이 OFF입니다 — 설정에서 활성화하세요');
  }
  if (!postingSlotByWorkspace(workspace)) {
    throw new Error('이 워크스페이스는 자동발행을 지원하지 않습니다');
  }

  const { data: account } = await supabase
    .from('huma_accounts')
    .select(
      'id, workspace, name, slot_label, auto_publish_kst_date, auto_publish_planned_count, warmup_day, posting_warmup_started_kst',
    )
    .eq('id', accountId)
    .eq('workspace', workspace)
    .eq('account_type', 'posting')
    .eq('is_active', true)
    .maybeSingle();

  if (!account) throw new Error('포스팅 계정을 찾을 수 없습니다');

  await resetPostingQuotaReservation(accountId);

  const kstDate = formatKstDateKey();
  if (!(account.posting_warmup_started_kst as string | null)?.trim()) {
    await supabase
      .from('huma_accounts')
      .update({ posting_warmup_started_kst: kstDate })
      .eq('id', accountId);
  }

  const planned = await resolveAutoPublishPlannedCountForDay(
    accountId,
    account.auto_publish_kst_date as string | null,
    account.auto_publish_planned_count as number | null,
  );

  const consumed = await countAutoPublishConsumedToday(accountId);
  if (consumed >= planned) {
    await persistAutoPublishPlan(accountId, {
      enabled: true,
      kst_date: kstDate,
      planned_count: planned,
      next_slot_at: null,
    });
    const state = await loadAutoPublishAccountState(accountId);
    if (!state) throw new Error('상태 조회 실패');
    return state;
  }

  const nextSlot = await planNextAutoPublishTriggerAt({
    accountId,
    plannedCount: planned,
    consumedCount: consumed,
  });

  await persistAutoPublishPlan(
    accountId,
    {
      enabled: true,
      kst_date: kstDate,
      planned_count: planned,
      next_slot_at: nextSlot,
    },
    { replaceSlot: true },
  );

  await logOperation({
    level: 'info',
    message:
      `[auto-publish] ON account=${accountId} planned=${planned} consumed=${consumed} next=${nextSlot ?? '내일'}`,
    workspace,
    account_id: accountId,
  });

  const state = await loadAutoPublishAccountState(accountId);
  if (!state) throw new Error('상태 조회 실패');
  return state;
}

/** 자동발행 OFF — 대기·처리 중 자동 job 취소 + 예약 슬롯 초기화 */
export async function disableAutoPublish(workspace: string, accountId: string): Promise<AutoPublishAccountState> {
  const cancelled = await cancelAutoPublishJobsOnDisable(accountId);
  await resetPostingQuotaReservation(accountId);

  const { data: account } = await supabase
    .from('huma_accounts')
    .select('auto_publish_kst_date, auto_publish_planned_count')
    .eq('id', accountId)
    .maybeSingle();

  await persistAutoPublishPlan(accountId, {
    enabled: false,
    kst_date: (account?.auto_publish_kst_date as string) ?? formatKstDateKey(),
    planned_count: (account?.auto_publish_planned_count as number) ?? 0,
    next_slot_at: null,
  });

  await logOperation({
    level: 'info',
    message:
      `[auto-publish] OFF account=${accountId} cancelled_content=${cancelled.content} cancelled_blog=${cancelled.blog} reserved_reset=1`,
    workspace,
    account_id: accountId,
  });

  const state = await loadAutoPublishAccountState(accountId);
  if (!state) throw new Error('상태 조회 실패');
  return state;
}

export async function setAutoPublishEnabled(
  workspace: string,
  accountId: string,
  enabled: boolean,
): Promise<AutoPublishAccountState> {
  return enabled ? enableAutoPublish(workspace, accountId) : disableAutoPublish(workspace, accountId);
}

/** 전체 중지 — auto_publish ON 계정 모두 OFF + 스냅샷 반환 */
export async function disableAllAutoPublish(): Promise<Array<{ id: string; workspace: string }>> {
  const { data } = await supabase
    .from('huma_accounts')
    .select('id, workspace')
    .eq('account_type', 'posting')
    .eq('is_active', true)
    .eq('auto_publish_enabled', true);

  const snapshot: Array<{ id: string; workspace: string }> = [];
  for (const row of data ?? []) {
    const id = row.id as string;
    const workspace = row.workspace as string;
    snapshot.push({ id, workspace });
    await disableAutoPublish(workspace, id);
  }

  if (snapshot.length) {
    await logOperation({
      level: 'info',
      message: `[auto-publish] 전체 중지 — ${snapshot.length}계정 OFF`,
      metadata: { account_ids: snapshot.map((s) => s.id) },
    });
  }

  return snapshot;
}

/** 재시작 — 전체 중지 직전 ON 이었던 계정 복구 */
export async function restoreAutoPublishFromSnapshot(
  snapshot: Array<{ id: string; workspace: string }>,
): Promise<number> {
  if (!getPostingEnabled() || !snapshot.length) return 0;

  let restored = 0;
  for (const { id, workspace } of snapshot) {
    try {
      await enableAutoPublish(workspace, id);
      restored++;
    } catch (err) {
      await logOperation({
        level: 'warn',
        message: `[auto-publish] 재시작 복구 실패 account=${id} — ${(err as Error).message}`,
        workspace,
        account_id: id,
      });
    }
  }

  if (restored > 0) {
    await logOperation({
      level: 'info',
      message: `[auto-publish] 재시작 — ${restored}/${snapshot.length}계정 ON 복구`,
    });
  }

  return restored;
}

export async function listAutoPublishEnabledAccounts(): Promise<AutoPublishAccountState[]> {
  const { data } = await supabase
    .from('huma_accounts')
    .select('id')
    .eq('account_type', 'posting')
    .eq('is_active', true)
    .eq('auto_publish_enabled', true);

  const states: AutoPublishAccountState[] = [];
  for (const row of data ?? []) {
    const state = await loadAutoPublishAccountState(row.id as string);
    if (state?.enabled) states.push(state);
  }
  return states;
}

/** 상태 조회·삭제 후 next_slot_at=null 고착 방지 — 짧은 쿨다운 */
const ensureAutoPublishSlotLastAt = new Map<string, number>();
const ENSURE_AUTO_PUBLISH_SLOT_COOLDOWN_MS = 15_000;

export async function ensureAutoPublishNextSlot(
  accountId: string,
  workspace: string,
): Promise<string | null> {
  const state = await loadAutoPublishAccountState(accountId);
  if (!state?.enabled || state.remaining_today <= 0) return state?.next_slot_at ?? null;

  const slotAt = state.next_slot_at;
  const slotMissing = !slotAt;
  const slotStale =
    slotAt != null && new Date(slotAt).getTime() < Date.now() - SHORT_SLOT_CLAIM_MS;
  if (!slotMissing && !slotStale) return slotAt;

  const now = Date.now();
  const last = ensureAutoPublishSlotLastAt.get(accountId) ?? 0;
  if (now - last < ENSURE_AUTO_PUBLISH_SLOT_COOLDOWN_MS) return slotAt;
  ensureAutoPublishSlotLastAt.set(accountId, now);

  await replanAutoPublishSlot(accountId, workspace, { force: true });
  const refreshed = await loadAutoPublishAccountState(accountId);
  return refreshed?.next_slot_at ?? null;
}

export async function replanAutoPublishSlot(
  accountId: string,
  workspace: string,
  opts?: { force?: boolean },
): Promise<void> {
  const state = await loadAutoPublishAccountState(accountId);
  if (!state?.enabled) return;

  if (!opts?.force && isFutureAutoPublishSlot(state.next_slot_at)) {
    await logOperation({
      level: 'info',
      message: `[auto-publish] replan skipped — future slot preserved (${state.next_slot_at})`,
      workspace,
      account_id: accountId,
    });
    return;
  }

  if (!opts?.force && isRecentDueRetrySlot(state.next_slot_at)) {
    await logOperation({
      level: 'info',
      message: `[auto-publish] replan skipped — due retry slot preserved (${state.next_slot_at})`,
      workspace,
      account_id: accountId,
    });
    return;
  }

  const kstDate = formatKstDateKey();
  const planned =
    state.kst_date === kstDate && state.planned_count != null
      ? state.planned_count
      : await resolveAutoPublishPlannedCountForDay(accountId, state.kst_date, state.planned_count);

  const consumed = await countAutoPublishConsumedToday(accountId);
  const nextSlot =
    consumed >= planned
      ? null
      : await planNextAutoPublishTriggerAt({ accountId, plannedCount: planned, consumedCount: consumed });

  await persistAutoPublishPlan(
    accountId,
    {
      enabled: true,
      kst_date: kstDate,
      planned_count: planned,
      next_slot_at: nextSlot,
    },
    { replaceSlot: Boolean(opts?.force) },
  );

  await logOperation({
    level: 'info',
    message: `[auto-publish] replan account=${accountId} consumed=${consumed}/${planned} next=${nextSlot ?? '없음'}${opts?.force ? ' (force)' : ''}`,
    workspace,
    account_id: accountId,
  });
}

/** 스케줄러 — due 슬롯에 content_full 1건 등록 */
export async function triggerDueAutoPublishJobs(): Promise<number> {
  if (!getPostingEnabled()) return 0;

  const enabled = await listAutoPublishEnabledAccounts();
  if (!enabled.length) return 0;

  let triggered = 0;
  const now = Date.now();

  for (const state of enabled) {
    if (!state.next_slot_at) continue;
    if (new Date(state.next_slot_at).getTime() > now) continue;
    if (autoPublishDueProcessing.has(state.id)) continue;

    const workspace = state.workspace;
    const accountId = state.id;
    const dueSlotAt = state.next_slot_at;
    autoPublishDueProcessing.add(accountId);

    try {
      const kstDate = formatKstDateKey();
      let planned =
        state.kst_date === kstDate && state.planned_count != null
          ? state.planned_count
          : await resolveAutoPublishPlannedCountForDay(
              accountId,
              state.kst_date,
              state.planned_count,
            );

      const consumed = await countAutoPublishConsumedToday(accountId);
      if (consumed >= planned) {
        await persistAutoPublishPlan(accountId, {
          enabled: true,
          kst_date: kstDate,
          planned_count: planned,
          next_slot_at: null,
        });
        continue;
      }

      if (await isNightBanActive()) {
        const nextSlot = await planNextAutoPublishTriggerAt({
          accountId,
          plannedCount: planned,
          consumedCount: consumed,
        });
        await persistAutoPublishPlan(accountId, {
          enabled: true,
          kst_date: kstDate,
          planned_count: planned,
          next_slot_at: nextSlot,
        });
        continue;
      }

      let pipelineJobs = await countInFlightPostingPipeline(accountId);
      let reservedSlots = await getPostingReservedToday(accountId);

      if (isOrphanPostingReservation(pipelineJobs, reservedSlots)) {
        const cleared = await clearOrphanPostingReservations(accountId, pipelineJobs);
        if (cleared > 0) {
          await logOperation({
            level: 'warn',
            message: `[auto-publish] orphan posting_reserved_today cleared=${cleared} account=${state.label ?? accountId} (pipeline=0)`,
            workspace,
            account_id: accountId,
          });
          reservedSlots = 0;
        }
      }

      const publishStatus = await getAutoPublishStatus(workspace, accountId);

      if (!publishStatus.can_publish) {
        if (publishStatus.block_reason === 'QUOTA') {
          await persistAutoPublishPlan(accountId, {
            enabled: true,
            kst_date: kstDate,
            planned_count: planned,
            next_slot_at: null,
          });
          await logOperation({
            level: 'warn',
            message:
              `[auto-publish] due stopped account=${state.label ?? accountId} QUOTA ` +
              `completed=${publishStatus.today_completed}/${publishStatus.daily_target} ` +
              `planned=${planned} consumed=${consumed} (no further defer)`,
            workspace,
            account_id: accountId,
          });
          continue;
        }

        const nextSlot = await resolveBlockedAutoPublishNextSlot(
          publishStatus,
          {
            accountId,
            plannedCount: planned,
            consumedCount: consumed,
          },
          dueSlotAt,
        );
        await persistAutoPublishPlan(accountId, {
          enabled: true,
          kst_date: kstDate,
          planned_count: planned,
          next_slot_at: nextSlot,
        });
        await logOperation({
          level: 'info',
          message:
            `[auto-publish] due blocked account=${state.label ?? accountId} reason=${publishStatus.block_reason ?? 'UNKNOWN'} ` +
            `completed=${publishStatus.today_completed}/${publishStatus.daily_target} ` +
            `pipeline=${pipelineJobs} reserved=${reservedSlots} consumed=${consumed}/${planned} next=${nextSlot}`,
          workspace,
          account_id: accountId,
        });
        continue;
      }

      try {
        const reserveOk = await reservePostingQuotaSlot(accountId);
        if (!reserveOk) {
          const retryAt = deferAutoPublishRetryIso(2, 4);
          await persistAutoPublishPlan(accountId, {
            enabled: true,
            kst_date: kstDate,
            planned_count: planned,
            next_slot_at: retryAt,
          });
          await logOperation({
            level: 'warn',
            message:
              `[auto-publish] due deferred account=${state.label ?? accountId} reserve denied ` +
              `(TS completed=${publishStatus.today_completed}/${publishStatus.daily_target} ` +
              `consumed=${consumed}/${planned}) — Supabase v3_66 SQL 적용·잘못된 completed job 정리 확인`,
            workspace,
            account_id: accountId,
          });
          continue;
        }
        await releasePostingQuotaSlot(accountId);

        const { registerAutoContentJobs } = await import('../modules/claude/auto-content-orchestrator.js');
        await registerAutoContentJobs({
          workspace,
          account_id: accountId,
          auto_schedule: true,
          content_type_auto: true,
          auto_publish: true,
        });
        triggered++;

        const consumedAfter = consumed + 1;
        const nextSlot =
          consumedAfter >= planned
            ? null
            : await planNextAutoPublishTriggerAt({
                accountId,
                plannedCount: planned,
                consumedCount: consumedAfter,
              });

        await persistAutoPublishPlan(accountId, {
          enabled: true,
          kst_date: kstDate,
          planned_count: planned,
          next_slot_at: nextSlot,
        });
      } catch (err) {
        const msg = (err as Error).message;
        const quotaHit = /한도|목표|도달|QUOTA/i.test(msg);
        await logOperation({
          level: 'warn',
          message: `[auto-publish] 트리거 실패 — ${msg}`,
          workspace,
          account_id: accountId,
        });
        const retryAt = quotaHit ? null : deferAutoPublishRetryIso(2, 4);
        await persistAutoPublishPlan(accountId, {
          enabled: true,
          kst_date: kstDate,
          planned_count: planned,
          next_slot_at: retryAt,
        });
      }
    } finally {
      autoPublishDueProcessing.delete(accountId);
    }
  }

  return triggered;
}

/** KST 자정 — enabled 계정 일일 계획 재설정 */
export async function rolloverAutoPublishDay(kstDate: string): Promise<void> {
  const workspaces = ['yeonun', 'panana', 'quizoasis'] as const;
  for (const workspace of workspaces) {
    if (!postingSlotByWorkspace(workspace)) continue;
    const accounts = await listPostingAccounts(workspace);
    for (const account of accounts) {
      const { data: row } = await supabase
        .from('huma_accounts')
        .select('auto_publish_enabled')
        .eq('id', account.id)
        .maybeSingle();

      if (!row?.auto_publish_enabled) continue;

      const planned = await resolveAutoPublishPlannedCountForDay(account.id, null, null);
      const nextSlot = await planNextAutoPublishTriggerAt({
        accountId: account.id,
        plannedCount: planned,
        consumedCount: 0,
      });

      await persistAutoPublishPlan(account.id, {
        enabled: true,
        kst_date: kstDate,
        planned_count: planned,
        next_slot_at: nextSlot,
      });
    }
  }
}
