'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { appAlert } from '@/lib/app-dialog';
import {
  formatYeonunAccountDisplayLabel,
  formatYeonunDongleGroupLabel,
  groupYeonunByDongle,
} from '@/lib/yeonun-dongle-groups';
import {
  AutoPublishChip,
  getInitialYeonunAccounts,
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

  const dongleGroups = useMemo(() => groupYeonunByDongle(accounts), [accounts]);

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
      if (!res.enabled) {
        const who = formatYeonunAccountDisplayLabel(row.account_label, {
          proxyPort: row.proxy_port ?? undefined,
        });
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
    <div
      className="flex flex-wrap items-stretch justify-end gap-y-2"
      aria-label="연운 계정별 자동 발행"
    >
      {dongleGroups.map((group, groupIndex) => (
        <div key={group.proxyPort} className="flex items-stretch">
          {groupIndex > 0 ? (
            <div
              className="mx-2 w-px shrink-0 self-stretch bg-huma-bdr/90"
              aria-hidden
              title={`${group.dongleLabel} 그룹`}
            />
          ) : null}
          <div
            className="flex flex-col gap-0.5"
            aria-label={`${group.dongleLabel} 동글`}
          >
            <div className="px-0.5 font-mono text-[9px] font-semibold uppercase tracking-wide text-huma-t3">
              {formatYeonunDongleGroupLabel(group.dongleLabel)}
            </div>
            <div className="flex flex-wrap items-start gap-2">
              {group.items.map((row, index) => {
                const label = formatYeonunAccountDisplayLabel(row.account_label, {
                  proxyPort: group.proxyPort,
                  indexInGroup: index,
                });
                const enabled = row.auto_publish_enabled ?? false;
                const busy = togglingId === row.account_id;

                return (
                  <AutoPublishChip
                    key={row.account_id ?? label}
                    status={row}
                    enabled={enabled}
                    busy={busy}
                    label={label}
                    syncing={syncing}
                    onToggle={() => void handleToggle(row)}
                  />
                );
              })}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
