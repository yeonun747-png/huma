'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { appAlert } from '@/lib/app-dialog';
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
        const who = row.account_label ?? '';
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
    <div className="flex flex-wrap items-start justify-end gap-2" aria-label="연운 계정별 자동 발행">
      {accounts.map((row, index) => {
        const label = row.account_label ?? row.account_id?.slice(0, 8) ?? `연운${index + 1}`;
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
  );
}
