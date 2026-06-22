'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { appAlert } from '@/lib/app-dialog';
import {
  formatAutoPublishButtonLabel,
  getInitialYeonunAccounts,
  isAutoPublishButtonDisabled,
  resolveAutoPublishButtonClass,
  setYeonunAccountsCache,
  type AutoPublishStatus,
} from './auto-publish-button';

interface YeonunPublishAccountsStripProps {
  refreshToken?: number;
  onDone?: () => void;
}

export function YeonunPublishAccountsStrip({ refreshToken = 0, onDone }: YeonunPublishAccountsStripProps) {
  const [accounts, setAccounts] = useState<AutoPublishStatus[]>(getInitialYeonunAccounts);
  const [syncing, setSyncing] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(() =>
    getInitialYeonunAccounts().some((a) => Boolean(a.account_id)),
  );

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setSyncing(true);
    try {
      const res = await api.getAutoPublishAccountsStatus('yeonun');
      const rows = res.accounts;
      if (rows.length) {
        setYeonunAccountsCache(rows);
        setAccounts(rows);
      }
      setLoaded(true);
    } catch {
      if (!getInitialYeonunAccounts().some((a) => a.account_id)) {
        setLoaded(true);
      }
    } finally {
      if (!opts?.silent) setSyncing(false);
    }
  }, []);

  useEffect(() => {
    const silent = getInitialYeonunAccounts().some((a) => Boolean(a.account_id));
    void load({ silent });
  }, [load, refreshToken]);

  const handleToggle = async (row: AutoPublishStatus) => {
    const accountId = row.account_id;
    if (!accountId || togglingId) return;

    const enabled = row.auto_publish_enabled ?? false;

    setTogglingId(accountId);
    try {
      const res = await api.toggleAutoPublish('yeonun', !enabled, accountId);
      const rows = res._meta?.accounts_status as AutoPublishStatus[] | undefined;
      if (rows?.length) {
        setYeonunAccountsCache(rows);
        setAccounts(rows);
      } else {
        await load();
      }
      const who = row.account_label ?? '';
      if (res.enabled) {
        await appAlert(
          `${who} 자동발행 ON\n오늘 계획 ${res.planned_count ?? '—'}건 · 남은 ${res.remaining_today ?? '—'}건`,
        );
      } else {
        await appAlert(`${who} 자동발행 OFF`);
      }
      onDone?.();
    } catch (e) {
      await appAlert(e instanceof Error ? e.message : '자동발행 변경 실패');
      await load();
    } finally {
      setTogglingId(null);
    }
  };

  if (loaded && !accounts.some((a) => a.account_id)) {
    return (
      <span className="font-mono text-[10px] text-huma-t3">연운 포스팅 계정 없음</span>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3" aria-label="연운 계정별 자동 발행">
      {accounts.map((row, index) => {
        const label = row.account_label ?? row.account_id?.slice(0, 8) ?? `연운${index + 1}`;
        const done = row.today_completed;
        const target = row.auto_publish_planned_count ?? row.daily_target || '—';
        const enabled = row.auto_publish_enabled ?? false;
        const busy = togglingId === row.account_id;
        const skippedHint =
          row.today_skipped && row.today_skipped > 0 ? ` · 스킵 ${row.today_skipped}` : '';
        const inFlightHint = row.in_flight ? ` · 파이프라인 ${row.in_flight}건` : '';
        const nextHint = row.auto_publish_next_slot_at
          ? ` · 다음 ${new Date(row.auto_publish_next_slot_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}`
          : enabled
            ? ' · 대기'
            : '';

        return (
          <div
            key={row.account_id ?? label}
            className={`flex shrink-0 items-center gap-1 rounded-md border border-transparent bg-huma-bg2/80 py-0.5 pl-2 pr-0.5 ${
              enabled ? 'ring-1 ring-emerald-500/30' : ''
            }`}
          >
            <span
              className={`shrink-0 font-mono text-[10px] font-bold tracking-tight ${
                enabled ? 'text-emerald-400' : 'text-huma-t3'
              }`}
              title={label}
            >
              {label}
            </span>
            <button
              type="button"
              className={resolveAutoPublishButtonClass(enabled)}
              disabled={isAutoPublishButtonDisabled({ busy })}
              title={
                syncing
                  ? '발행 현황 불러오는 중…'
                  : enabled
                    ? `${label} 자동발행 ON${nextHint}${inFlightHint}${skippedHint}`
                    : `클릭하여 ${label} 자동발행 ON${inFlightHint}${
                        row.block_message ? ` (${row.block_message})` : ''
                      }${skippedHint}`
              }
              onClick={() => void handleToggle(row)}
            >
              {formatAutoPublishButtonLabel(done, target, { publishing: busy, enabled })}
            </button>
          </div>
        );
      })}
    </div>
  );
}
