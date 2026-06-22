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
};

interface AutoPublishButtonProps {
  workspace: Workspace;
  onDone: () => void;
}

export function AutoPublishButton({ workspace, onDone }: AutoPublishButtonProps) {
  const [status, setStatus] = useState<AutoPublishStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [publishing, setPublishing] = useState(false);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const s = await api.getAutoPublishStatus(workspace);
      setStatus(s);
    } catch {
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, [workspace]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const handlePublish = async () => {
    if (!status?.can_publish || publishing) return;
    setPublishing(true);
    try {
      const job = await api.runAutoPublish(workspace);
      const meta = job._meta as { auto_pick_label?: string; daily_status?: AutoPublishStatus } | undefined;
      const label = meta?.auto_pick_label ?? job.title ?? '자동 발행';
      const daily = meta?.daily_status;
      const progress = daily ? `${daily.today_completed}/${daily.daily_target}` : '';
      const who = daily?.account_label ? ` (${daily.account_label})` : '';
      await appAlert(
        `${label}\n포스팅 큐 등록 완료${who}${progress ? ` · 오늘 발행 완료 ${progress}건` : ''}`,
      );
      await loadStatus();
      onDone();
    } catch (e) {
      await appAlert(e instanceof Error ? e.message : '자동 발행 실패');
      await loadStatus();
    } finally {
      setPublishing(false);
    }
  };

  const done = status?.today_completed ?? 0;
  const quota = status?.daily_target ?? '—';
  const accountHint = status?.account_label ? ` · ${status.account_label}` : '';
  const warmupHint =
    status?.warmup_cap != null ? ` · 워밍업 상한 ${status.warmup_cap}건` : '';
  const disabled = loading || publishing || !status?.can_publish;

  const title =
    status?.block_message ??
    (status?.can_publish
      ? `다음 순환 계정${accountHint} · 평일 4~5건 · 주말 40~50%${warmupHint}`
      : '');

  return (
    <button
      type="button"
      className="btn-primary btn-sm px-2.5 py-1"
      disabled={disabled}
      title={title}
      onClick={() => void handlePublish()}
    >
      {publishing ? '등록 중…' : loading ? '…' : `⚡ 자동 발행 ${done}/${quota}`}
    </button>
  );
}
