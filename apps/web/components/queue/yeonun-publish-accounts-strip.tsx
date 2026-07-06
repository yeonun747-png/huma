'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Workspace } from '@huma/shared';
import { api } from '@/lib/api';
import { appAlert } from '@/lib/app-dialog';
import {
  formatPostingAccountDisplayLabel,
  formatYeonunDongleGroupLabel,
  groupPostingAccountsByDongle,
} from '@/lib/yeonun-dongle-groups';
import {
  AutoPublishChip,
  getInitialYeonunAccounts,
  setYeonunAccountsCache,
  type AutoPublishStatus,
} from './auto-publish-button';

const POSTING_STRIP_WORKSPACES: Workspace[] = ['yeonun', 'quizoasis', 'panana'];

export function isPostingStripWorkspace(workspace: Workspace): boolean {
  return POSTING_STRIP_WORKSPACES.includes(workspace);
}

const WORKSPACE_EMPTY_LABEL: Record<Workspace, string> = {
  yeonun: '연운 포스팅 계정 없음',
  quizoasis: '퀴즈오아시스 포스팅 계정 없음',
  panana: '파나나 포스팅 계정 없음',
};

interface WorkspacePublishAccountsStripProps {
  workspace: Workspace;
  refreshToken?: number;
  onDone?: () => void;
}

/** 워크스페이스별 포스팅 계정 자동발행 칩 (연운·퀴즈오아시스·파나나) */
export function WorkspacePublishAccountsStrip({
  workspace,
  refreshToken = 0,
  onDone,
}: WorkspacePublishAccountsStripProps) {
  const initialRows = workspace === 'yeonun' ? getInitialYeonunAccounts() : [];
  const [accounts, setAccounts] = useState<AutoPublishStatus[]>(initialRows);
  const [nextPublishAccountId, setNextPublishAccountId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(() =>
    workspace === 'yeonun' ? getInitialYeonunAccounts().some((a) => Boolean(a.account_id)) : false,
  );

  const dongleGroups = useMemo(
    () => groupPostingAccountsByDongle(workspace, accounts),
    [workspace, accounts],
  );

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setSyncing(true);
    try {
      const res = await api.getAutoPublishAccountsStatus(workspace);
      const rows = res.accounts;
      if (rows.length) {
        if (workspace === 'yeonun') setYeonunAccountsCache(rows);
        setAccounts(rows);
      } else if (workspace !== 'yeonun') {
        setAccounts([]);
      }
      setNextPublishAccountId(res.next_publish_account_id ?? null);
      setLoaded(true);
    } catch {
      if (workspace === 'yeonun' && !getInitialYeonunAccounts().some((a) => a.account_id)) {
        setLoaded(true);
      } else if (workspace !== 'yeonun') {
        setLoaded(true);
      }
    } finally {
      if (!opts?.silent) setSyncing(false);
    }
  }, [workspace]);

  useEffect(() => {
    const silent =
      workspace === 'yeonun' && getInitialYeonunAccounts().some((a) => Boolean(a.account_id));
    void load({ silent });
  }, [load, refreshToken, workspace]);

  const handleToggle = async (row: AutoPublishStatus) => {
    const accountId = row.account_id;
    if (!accountId || togglingId) return;

    const enabled = row.auto_publish_enabled ?? false;

    setTogglingId(accountId);
    try {
      const res = await api.toggleAutoPublish(workspace, !enabled, accountId);
      const rows = res._meta?.accounts_status as AutoPublishStatus[] | undefined;
      if (rows?.length) {
        if (workspace === 'yeonun') setYeonunAccountsCache(rows);
        setAccounts(rows);
      }
      await load({ silent: true });
      if (!res.enabled) {
        const who = formatPostingAccountDisplayLabel(workspace, row.account_label, {
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

  const dongleGroupLabel =
    workspace === 'yeonun'
      ? formatYeonunDongleGroupLabel
      : (label: string) => label;

  if (loaded && !accounts.some((a) => a.account_id)) {
    return (
      <span className="font-mono text-[10px] text-huma-t3">
        {WORKSPACE_EMPTY_LABEL[workspace] ?? '포스팅 계정 없음'}
      </span>
    );
  }

  return (
    <div
      className="flex flex-wrap items-stretch justify-end gap-y-2"
      aria-label={`${workspace} 계정별 자동 발행`}
    >
      {dongleGroups.map((group, groupIndex) => (
        <div key={group.proxyPort || group.dongleLabel} className="flex items-stretch">
          {groupIndex > 0 ? (
            <div
              className="mx-2 w-px shrink-0 self-stretch bg-huma-bdr/90"
              aria-hidden
              title={`${group.dongleLabel} 그룹`}
            />
          ) : null}
          <div className="flex flex-col gap-0.5" aria-label={`${group.dongleLabel} 동글`}>
            <div className="px-0.5 font-mono text-[9px] font-semibold uppercase tracking-wide text-huma-t3">
              {dongleGroupLabel(group.dongleLabel)}
            </div>
            <div className="flex flex-wrap items-start gap-2">
              {group.items.map((row, index) => {
                const label = formatPostingAccountDisplayLabel(workspace, row.account_label, {
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
                    showNextPublishBadge={
                      Boolean(
                        row.account_id &&
                          nextPublishAccountId &&
                          row.account_id === nextPublishAccountId,
                      )
                    }
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

/** @deprecated WorkspacePublishAccountsStrip 사용 */
export const YeonunPublishAccountsStrip = (props: Omit<WorkspacePublishAccountsStripProps, 'workspace'>) => (
  <WorkspacePublishAccountsStrip workspace="yeonun" {...props} />
);
