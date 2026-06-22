'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { appAlert } from '@/lib/app-dialog';
import type { AutoPublishStatus } from './auto-publish-button';

interface YeonunPublishAccountsStripProps {
  refreshToken?: number;
  onDone?: () => void;
}

function barPct(done: number, target: number): number {
  if (target <= 0) return 0;
  return Math.min(100, Math.round((done / target) * 100));
}

export function YeonunPublishAccountsStrip({ refreshToken = 0, onDone }: YeonunPublishAccountsStripProps) {
  const [accounts, setAccounts] = useState<AutoPublishStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [publishingId, setPublishingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getAutoPublishAccountsStatus('yeonun');
      setAccounts(res.accounts);
    } catch {
      setAccounts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshToken]);

  const handlePublish = async (row: AutoPublishStatus) => {
    const accountId = row.account_id;
    if (!accountId || !row.can_publish || publishingId) return;

    setPublishingId(accountId);
    try {
      const job = await api.runAutoPublish('yeonun', accountId);
      const meta = job._meta as { auto_pick_label?: string; daily_status?: AutoPublishStatus } | undefined;
      const label = meta?.auto_pick_label ?? job.title ?? '자동 발행';
      const daily = meta?.daily_status;
      const progress = daily ? `${daily.today_completed}/${daily.daily_target}` : '';
      const who = daily?.account_label ?? row.account_label ?? '';
      await appAlert(
        `${label}\n포스팅 큐 등록 완료 (${who})${progress ? ` · 오늘 발행 완료 ${progress}건` : ''}`,
      );
      await load();
      onDone?.();
    } catch (e) {
      await appAlert(e instanceof Error ? e.message : '자동 발행 실패');
      await load();
    } finally {
      setPublishingId(null);
    }
  };

  if (loading && !accounts.length) {
    return (
      <div className="w-full min-w-[240px] font-mono text-[10px] text-huma-t3">계정 현황 불러오는 중…</div>
    );
  }

  if (!accounts.length) {
    return (
      <div className="w-full min-w-[240px] font-mono text-[10px] text-huma-t3">연운 포스팅 계정 없음</div>
    );
  }

  return (
    <div
      className="grid w-full min-w-[280px] grid-cols-3 rounded border border-huma-bdr bg-huma-bg2/80 px-1 py-1 font-mono text-[10px]"
      aria-label="연운 계정별 자동 발행"
    >
      {accounts.map((row, i) => {
        const label = row.account_label ?? row.account_id?.slice(0, 8) ?? '계정';
        const pct = barPct(row.today_completed, row.daily_target);
        const full = row.remaining <= 0;
        const busy = publishingId === row.account_id;
        const disabled = loading || busy || !row.can_publish || publishingId != null;
        const inFlightHint = row.in_flight ? ` · 파이프라인 ${row.in_flight}건` : '';

        return (
          <div
            key={row.account_id ?? label}
            className={`flex min-w-0 flex-col gap-1 overflow-hidden px-1 ${i > 0 ? 'border-l border-huma-bdr' : ''}`}
          >
            <div className="flex min-w-0 items-center gap-1">
              <span
                className={`w-9 shrink-0 truncate ${full ? 'text-huma-t3' : 'text-huma-t'}`}
                title={label}
              >
                {label}
              </span>
              <span
                className={`inline-flex w-10 shrink-0 justify-end tabular-nums ${full ? 'text-huma-ok' : 'text-huma-t2'}`}
              >
                {row.today_completed}/{row.daily_target}
                <span className={full ? '' : 'invisible'} aria-hidden={!full}>
                  ✓
                </span>
              </span>
              <div className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-huma-bg3">
                <div
                  className={`h-full rounded-full ${full ? 'bg-huma-ok/70' : 'bg-huma-acc/80'}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
            <button
              type="button"
              className="btn-primary btn-sm w-full px-1 py-0.5 text-[10px] leading-tight disabled:opacity-40"
              disabled={disabled}
              title={
                row.block_message ??
                (row.can_publish
                  ? `${label} 자동 발행 · 평일 4~5건 · 주말 40~50%${inFlightHint}`
                  : `${label} 발행 불가${inFlightHint}`)
              }
              onClick={() => void handlePublish(row)}
            >
              {busy ? '등록 중…' : '⚡ 발행'}
            </button>
          </div>
        );
      })}
    </div>
  );
}
