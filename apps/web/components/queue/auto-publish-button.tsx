'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Workspace } from '@huma/shared';
import { api } from '@/lib/api';
import { appAlert } from '@/lib/app-dialog';

export type AutoPublishStatus = {
  workspace: string;
  account_id?: string;
  account_label?: string;
  today_completed: number;
  today_skipped?: number;
  daily_target: number;
  weekday_base: number;
  remaining: number;
  hard_cap: number;
  can_publish: boolean;
  block_reason?: string;
  block_message?: string;
  auto_pick_ready: boolean;
  is_weekend: boolean;
  weekend_ratio?: number;
  warmup_cap?: number;
  in_flight?: number;
  auto_publish_enabled?: boolean;
  auto_publish_planned_count?: number | null;
  auto_publish_next_slot_at?: string | null;
};

export const AUTO_PUBLISH_BTN_CLASS =
  'btn-primary btn-sm shrink-0 whitespace-nowrap px-2.5 py-1 disabled:cursor-not-allowed disabled:opacity-40';

/** OFF — 퀴즈·파나나·연운 공통 분홍 활성 버튼 */
export const AUTO_PUBLISH_BTN_OFF_CLASS = AUTO_PUBLISH_BTN_CLASS;

export const AUTO_PUBLISH_BTN_ON_CLASS =
  'btn-primary btn-sm shrink-0 whitespace-nowrap px-2.5 py-1 ring-2 ring-emerald-400/70 disabled:cursor-not-allowed disabled:opacity-40';

export function resolveAutoPublishButtonClass(enabled: boolean): string {
  return enabled ? AUTO_PUBLISH_BTN_ON_CLASS : AUTO_PUBLISH_BTN_CLASS;
}

export function isAutoPublishButtonDisabled(opts: { busy?: boolean }): boolean {
  return Boolean(opts.busy);
}

export function formatAutoPublishButtonLabel(
  done: number,
  quota: number | string,
  opts?: { publishing?: boolean; enabled?: boolean },
): string {
  if (opts?.publishing) return '처리 중…';
  const prefix = opts?.enabled ? '⚡ ON' : '⚡ 자동발행';
  return `${prefix} ${done}/${quota}`;
}

const publishStatusCache = new Map<string, AutoPublishStatus>();
let yeonunAccountsCache: AutoPublishStatus[] = [];

export function buildYeonunPlaceholderAccounts(): AutoPublishStatus[] {
  return (['연운1', '연운2', '연운3'] as const).map((account_label) => ({
    workspace: 'yeonun',
    account_label,
    today_completed: 0,
    today_skipped: 0,
    daily_target: 0,
    weekday_base: 4,
    remaining: 0,
    hard_cap: 99,
    can_publish: false,
    auto_pick_ready: true,
    is_weekend: false,
    auto_publish_enabled: false,
  }));
}

export function getInitialYeonunAccounts(): AutoPublishStatus[] {
  if (yeonunAccountsCache.length) return yeonunAccountsCache;
  return buildYeonunPlaceholderAccounts();
}

export function setYeonunAccountsCache(rows: AutoPublishStatus[]) {
  yeonunAccountsCache = rows;
}

export type YeonunAccountOption = { id: string; label: string };

const YEONUN_PLACEHOLDER_ID_PREFIX = '__yeonun_pending__:';

export function isYeonunPlaceholderAccountId(id: string): boolean {
  return id.startsWith(YEONUN_PLACEHOLDER_ID_PREFIX);
}

export function toYeonunAccountOptions(rows: AutoPublishStatus[]): YeonunAccountOption[] {
  const withIds = rows
    .filter((a) => a.account_id)
    .map((a) => ({
      id: a.account_id!,
      label: a.account_label ?? a.account_id!,
    }));
  if (withIds.length) return withIds;

  const labels =
    rows.length > 0
      ? rows.map((a, i) => a.account_label ?? `연운${i + 1}`)
      : (['연운1', '연운2', '연운3'] as const);
  return labels.map((label) => ({
    id: `${YEONUN_PLACEHOLDER_ID_PREFIX}${label}`,
    label,
  }));
}

export function resolveYeonunAccountId(
  selectedId: string,
  rows: AutoPublishStatus[],
): string | null {
  if (!selectedId) return null;
  if (!isYeonunPlaceholderAccountId(selectedId)) return selectedId;
  const label = selectedId.slice(YEONUN_PLACEHOLDER_ID_PREFIX.length);
  const byLabel = rows.find((a) => a.account_id && a.account_label === label);
  if (byLabel?.account_id) return byLabel.account_id;
  return rows.find((a) => a.account_id)?.account_id ?? null;
}

interface AutoPublishButtonProps {
  workspace: Workspace;
  onDone: () => void;
  refreshToken?: number;
}

export function AutoPublishButton({ workspace, onDone, refreshToken = 0 }: AutoPublishButtonProps) {
  const [status, setStatus] = useState<AutoPublishStatus | null>(
    () => publishStatusCache.get(workspace) ?? null,
  );
  const [syncing, setSyncing] = useState(() => !publishStatusCache.has(workspace));
  const [toggling, setToggling] = useState(false);

  const loadStatus = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setSyncing(true);
    try {
      const s = await api.getAutoPublishStatus(workspace);
      publishStatusCache.set(workspace, s);
      setStatus(s);
    } catch {
      setStatus(publishStatusCache.get(workspace) ?? null);
    } finally {
      if (!opts?.silent) setSyncing(false);
    }
  }, [workspace]);

  useEffect(() => {
    void loadStatus({ silent: publishStatusCache.has(workspace) });
  }, [loadStatus, refreshToken, workspace]);

  const handleToggle = async () => {
    if (toggling) return;
    const enabled = status?.auto_publish_enabled ?? false;

    setToggling(true);
    try {
      const res = await api.toggleAutoPublish(workspace, !enabled);
      const daily = res._meta?.daily_status as AutoPublishStatus | undefined;
      if (daily) {
        publishStatusCache.set(workspace, daily);
        setStatus(daily);
      } else {
        await loadStatus();
      }
      if (res.enabled) {
        const planned = res.planned_count ?? daily?.auto_publish_planned_count ?? daily?.daily_target;
        await appAlert(
          `자동발행 ON\n오늘 계획 ${planned}건 · 남은 ${res.remaining_today ?? '—'}건\n스케줄러가 간격을 맞춰 등록합니다`,
        );
      } else {
        await appAlert('자동발행 OFF — 대기 중인 자동 작업은 취소됩니다');
      }
      onDone();
    } catch (e) {
      await appAlert(e instanceof Error ? e.message : '자동발행 변경 실패');
      await loadStatus();
    } finally {
      setToggling(false);
    }
  };

  const done = status?.today_completed ?? 0;
  const quota =
    status?.auto_publish_planned_count ?? (status?.daily_target ? status.daily_target : '—');
  const enabled = status?.auto_publish_enabled ?? false;
  const label = status?.account_label?.trim();
  const accountHint = label ? ` · ${label}` : '';
  const warmupHint =
    status?.warmup_cap != null ? ` · 워밍업 상한 ${status.warmup_cap}건` : '';
  const skippedHint =
    status?.today_skipped && status.today_skipped > 0 ? ` · 유사도 스킵 ${status.today_skipped}건` : '';
  const nextHint = status?.auto_publish_next_slot_at
    ? ` · 다음 ${new Date(status.auto_publish_next_slot_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}`
    : enabled
      ? ' · 오늘 계획 완료 또는 야간 대기'
      : '';

  const title = syncing
    ? '발행 현황 불러오는 중…'
    : enabled
      ? `자동발행 ON${accountHint}${nextHint}${skippedHint}`
      : `클릭하여 자동발행 ON · 평일 4~5건${warmupHint}${
          status?.block_message ? ` (${status.block_message})` : ''
        }${skippedHint}`;

  return (
    <div
      className={`flex shrink-0 items-center gap-1 rounded-md border border-transparent bg-huma-bg2/80 py-0.5 pl-2 pr-0.5 ${
        enabled ? 'ring-1 ring-emerald-500/30' : ''
      }`}
    >
      {label ? (
        <span
          className={`shrink-0 font-mono text-[10px] font-bold tracking-tight ${
            enabled ? 'text-emerald-400' : 'text-huma-t3'
          }`}
          title={label}
        >
          {label}
        </span>
      ) : null}
      <button
        type="button"
        className={resolveAutoPublishButtonClass(enabled)}
        disabled={isAutoPublishButtonDisabled({ busy: toggling })}
        title={title}
        onClick={() => void handleToggle()}
      >
        {formatAutoPublishButtonLabel(done, quota, { publishing: toggling, enabled })}
      </button>
    </div>
  );
}
