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
  proxy_port?: number | null;
  next_queued_at?: string | null;
  is_active?: boolean;
  next_publish_account_id?: string | null;
};

export const AUTO_PUBLISH_BTN_CLASS =
  'btn-primary btn-sm shrink-0 whitespace-nowrap px-2.5 py-1 disabled:cursor-not-allowed disabled:opacity-40';

/** OFF — 퀴즈·파나나·연운 공통 분홍(워크스페이스 accent) 활성 버튼 */
export const AUTO_PUBLISH_BTN_OFF_CLASS = AUTO_PUBLISH_BTN_CLASS;

/** ON — accent2 링·글로우 (emerald 대신 워크스페이스 accent 계열) */
export const AUTO_PUBLISH_BTN_ON_CLASS =
  'btn-primary btn-sm auto-publish-btn--on shrink-0 whitespace-nowrap px-2.5 py-1 disabled:cursor-not-allowed disabled:opacity-40';

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

function formatNextSlotTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
}

function resolvePlannedTotal(status: AutoPublishStatus): number | null {
  const raw = status.auto_publish_planned_count ?? status.daily_target;
  if (raw == null || raw === 0) return null;
  if (status.daily_target > 0) return Math.min(raw, status.daily_target);
  return raw;
}

/** ON 상태 스케줄·진행률 한 줄 요약 */
export function formatAutoPublishScheduleLine(status: AutoPublishStatus): string {
  const planned = resolvePlannedTotal(status);
  const done = status.today_completed ?? 0;
  const skipped = status.today_skipped ?? 0;
  const parts: string[] = [];

  const queuedAt = status.next_queued_at ? new Date(status.next_queued_at).getTime() : null;
  const slotAt = status.auto_publish_next_slot_at
    ? new Date(status.auto_publish_next_slot_at).getTime()
    : null;

  if (queuedAt != null && (slotAt == null || queuedAt <= slotAt)) {
    parts.push(`큐 예약 ${formatNextSlotTime(status.next_queued_at!)}`);
  } else if (status.auto_publish_next_slot_at) {
    parts.push(`다음 큐 등록 ${formatNextSlotTime(status.auto_publish_next_slot_at)}`);
  } else if (planned != null && done >= planned) {
    parts.push('오늘 계획 등록 완료 · 실행 대기');
  } else if (status.block_message) {
    parts.push(status.block_message);
  } else if (status.auto_publish_enabled) {
    parts.push('슬롯 계산 중…');
  }

  if (status.in_flight && status.in_flight > 0) {
    parts.push(`파이프라인 ${status.in_flight}건`);
  }
  if (skipped > 0) {
    parts.push(`유사도 스킵 ${skipped}`);
  }
  return parts.join(' · ') || '스케줄러 대기';
}

export function buildAutoPublishTitle(
  status: AutoPublishStatus | null,
  opts: { syncing?: boolean; enabled: boolean; label?: string },
): string {
  if (opts.syncing) return '발행 현황 불러오는 중…';
  if (!status) return '자동발행';
  const accountHint = opts.label ? `${opts.label} · ` : '';
  if (opts.enabled) {
    const line = formatAutoPublishScheduleLine(status);
    const hint = status.auto_publish_next_slot_at
      ? ' (해당 시각에 큐에 작업 등록 → AI 작성 후 발행 예약)'
      : '';
    return `${accountHint}자동발행 ON · ${line}${hint}`;
  }
  const warmupHint = status.warmup_cap != null ? ` · 워밍업 상한 ${status.warmup_cap}건` : '';
  return `${accountHint}클릭하여 자동발행 ON · 평일 4~5건${warmupHint}${
    status.block_message ? ` (${status.block_message})` : ''
  }`;
}

type AutoPublishChipProps = {
  status: AutoPublishStatus;
  enabled: boolean;
  busy: boolean;
  label?: string;
  syncing?: boolean;
  showNextPublishBadge?: boolean;
  onToggle: () => void;
};

/** 자동발행 버튼 + ON 시 진행률·다음 슬롯 시각 */
export function AutoPublishChip({
  status,
  enabled,
  busy,
  label,
  syncing,
  showNextPublishBadge = false,
  onToggle,
}: AutoPublishChipProps) {
  const done = status.today_completed ?? 0;
  const planned = resolvePlannedTotal(status);
  const quota = planned ?? (status.daily_target ? status.daily_target : '—');
  const progressPct =
    planned != null && planned > 0 ? Math.min(100, Math.round((done / planned) * 100)) : null;
  const scheduleLine = enabled ? formatAutoPublishScheduleLine(status) : null;

  return (
    <div
      className={`auto-publish-chip flex shrink-0 flex-col ${enabled ? 'auto-publish-chip--on' : ''}`}
    >
      {showNextPublishBadge ? (
        <span className="auto-publish-next-badge" aria-hidden>
          <span className="auto-publish-next-badge-text">다음발행</span>
        </span>
      ) : null}
      <div className="auto-publish-chip-row flex items-center gap-2">
        {label ? (
          <span
            className={`auto-publish-chip-label shrink-0 font-mono text-[10px] font-bold tracking-tight ${
              enabled ? 'text-[var(--acc2)]' : 'text-huma-t3'
            }`}
            title={label}
          >
            {label}
          </span>
        ) : null}
        <button
          type="button"
          className={resolveAutoPublishButtonClass(enabled)}
          disabled={isAutoPublishButtonDisabled({ busy })}
          title={buildAutoPublishTitle(status, { syncing, enabled, label })}
          onClick={onToggle}
        >
          {formatAutoPublishButtonLabel(done, quota, { publishing: busy, enabled })}
        </button>
      </div>
      {enabled && scheduleLine ? (
        <div className="auto-publish-chip-meta flex min-w-0 items-center gap-1.5" aria-live="polite">
          {progressPct != null ? (
            <div
              className="auto-publish-progress-track shrink-0"
              title={`오늘 ${done}/${planned}건 완료`}
              role="progressbar"
              aria-valuenow={done}
              aria-valuemin={0}
              aria-valuemax={planned ?? 0}
            >
              <div className="auto-publish-progress-fill" style={{ width: `${progressPct}%` }} />
            </div>
          ) : null}
          <span className="truncate font-mono text-[9px] leading-snug text-huma-t2">{scheduleLine}</span>
        </div>
      ) : null}
    </div>
  );
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

function buildSingleDonglePlaceholderAccounts(
  workspace: Workspace,
  labels: readonly string[],
): AutoPublishStatus[] {
  return labels.map((account_label) => ({
    workspace,
    account_label,
    today_completed: 0,
    today_skipped: 0,
    daily_target: 0,
    weekday_base: 2,
    remaining: 0,
    hard_cap: 99,
    can_publish: false,
    auto_pick_ready: true,
    is_weekend: false,
    auto_publish_enabled: false,
  }));
}

export function buildWorkspacePlaceholderAccounts(workspace: Workspace): AutoPublishStatus[] {
  if (workspace === 'yeonun') return buildYeonunPlaceholderAccounts();
  if (workspace === 'quizoasis') {
    return buildSingleDonglePlaceholderAccounts(workspace, ['퀴즈오아시스-1', '퀴즈오아시스-2']);
  }
  if (workspace === 'panana') {
    return buildSingleDonglePlaceholderAccounts(workspace, ['파나나-1', '파나나-2']);
  }
  return [];
}

export function getInitialWorkspaceAccounts(workspace: Workspace): AutoPublishStatus[] {
  if (workspace === 'yeonun') return getInitialYeonunAccounts();
  return buildWorkspacePlaceholderAccounts(workspace);
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
  const [nextPublishAccountId, setNextPublishAccountId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(() => !publishStatusCache.has(workspace));
  const [toggling, setToggling] = useState(false);

  const loadStatus = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setSyncing(true);
    try {
      const s = await api.getAutoPublishStatus(workspace);
      publishStatusCache.set(workspace, s);
      setStatus(s);
      setNextPublishAccountId(s.next_publish_account_id ?? null);
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
      let accountId = status?.account_id;
      if (!accountId) {
        try {
          const res = await api.getAutoPublishAccountsStatus(workspace);
          accountId = res.accounts.find((a) => a.account_id)?.account_id;
        } catch {
          /* status 조회 실패 시 아래 공통 안내 */
        }
      }
      if (!accountId) {
        await appAlert('포스팅 계정을 찾을 수 없습니다. 계정 관리에서 포스팅 계정을 등록해 주세요.');
        return;
      }

      const res = await api.toggleAutoPublish(workspace, !enabled, accountId);
      const daily = res._meta?.daily_status as AutoPublishStatus | undefined;
      if (daily) {
        publishStatusCache.set(workspace, daily);
        setStatus(daily);
      }
      await loadStatus({ silent: true });
      if (res.enabled) {
        /* ON — 칩 UI에 계획·다음 슬롯 표시, 모달 생략 */
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

  const enabled = status?.auto_publish_enabled ?? false;

  if (!status) {
    return (
      <div className="relative inline-flex shrink-0">
        <button
          type="button"
          className={AUTO_PUBLISH_BTN_CLASS}
          disabled={syncing || toggling}
          title={syncing ? '발행 현황 불러오는 중…' : '자동발행'}
          onClick={() => void handleToggle()}
        >
          {formatAutoPublishButtonLabel(0, '—', { publishing: toggling || syncing })}
        </button>
      </div>
    );
  }

  return (
    <AutoPublishChip
      status={status}
      enabled={enabled}
      busy={toggling}
      syncing={syncing}
      showNextPublishBadge={
        Boolean(
          status.account_id &&
            nextPublishAccountId &&
            status.account_id === nextPublishAccountId,
        )
      }
      onToggle={() => void handleToggle()}
    />
  );
}
