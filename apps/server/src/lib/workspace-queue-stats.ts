import { supabase } from '../middleware/auth.js';
import { formatKstDateKey } from './posting-daily-target.js';
import { kstTodayStartIso } from './posting-daily-status.js';
import {
  computeVisibleQueueStats,
  countContentFullPipelineShells,
  countSocialCrankJobs,
} from './job-pipeline-shell.js';

export type WorkspaceQueueStatsRow = {
  workspace: string;
  queue_visible_total: number;
  done_all: number;
  done_today: number;
  stats_kst_date: string;
  updated_at: string;
};

export type QueueStatsResponse = {
  pending: number;
  running: number;
  doneToday: number;
  doneAll: number;
};

const refreshTimers = new Map<string, ReturnType<typeof setTimeout>>();
const REFRESH_DEBOUNCE_MS = 400;

/** job 생성·완료·삭제 후 debounce 재집계 (페이지 로드 시 full scan 방지) */
export function scheduleWorkspaceQueueStatsRefresh(workspace: string | null | undefined): void {
  if (!workspace?.trim()) return;
  const ws = workspace.trim();
  const prev = refreshTimers.get(ws);
  if (prev) clearTimeout(prev);
  refreshTimers.set(
    ws,
    setTimeout(() => {
      refreshTimers.delete(ws);
      void recomputeAndPersistWorkspaceQueueStats(ws).catch((err) => {
        console.error('[queue-stats] refresh failed', ws, err);
      });
    }, REFRESH_DEBOUNCE_MS),
  );
}

export function scheduleWorkspaceQueueStatsRefreshMany(
  workspaces: Iterable<string | null | undefined>,
): void {
  const seen = new Set<string>();
  for (const w of workspaces) {
    if (!w?.trim()) continue;
    const ws = w.trim();
    if (seen.has(ws)) continue;
    seen.add(ws);
    scheduleWorkspaceQueueStatsRefresh(ws);
  }
}

async function countQueueVisibleTotal(workspace: string): Promise<number> {
  const { count: allCount, error } = await supabase
    .from('huma_jobs')
    .select('*', { count: 'exact', head: true })
    .eq('workspace', workspace);
  if (error) return 0;
  const [shellTotal, crankTotal] = await Promise.all([
    countContentFullPipelineShells(workspace),
    countSocialCrankJobs(workspace),
  ]);
  return Math.max(0, (allCount ?? 0) - shellTotal - crankTotal);
}

/** done_all·done_today·pagination total — completed 전체 스캔 (mutation/backfill 전용) */
export async function recomputeAndPersistWorkspaceQueueStats(
  workspace: string,
): Promise<WorkspaceQueueStatsRow> {
  const todayStart = kstTodayStartIso();
  const statsKstDate = formatKstDateKey(new Date());

  const [visibleCompleted, queueVisibleTotal] = await Promise.all([
    computeVisibleQueueStats(workspace, todayStart),
    countQueueVisibleTotal(workspace),
  ]);

  const row = {
    workspace,
    queue_visible_total: queueVisibleTotal,
    done_all: visibleCompleted.doneAll,
    done_today: visibleCompleted.doneToday,
    stats_kst_date: statsKstDate,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from('huma_workspace_queue_stats')
    .upsert(row, { onConflict: 'workspace' })
    .select()
    .single();

  if (error) throw error;
  return data as WorkspaceQueueStatsRow;
}

async function fetchLivePendingRunning(workspace: string): Promise<{ pending: number; running: number }> {
  const base = () =>
    supabase
      .from('huma_jobs')
      .select('*', { count: 'exact', head: true })
      .eq('workspace', workspace)
      .neq('job_type', 'social_crank');
  const [pendingRes, runningRes, captchaRes] = await Promise.all([
    base().in('status', ['pending', 'scheduled']),
    base().eq('status', 'running'),
    base().eq('status', 'awaiting_captcha'),
  ]);
  return {
    pending: pendingRes.count ?? 0,
    running: (runningRes.count ?? 0) + (captchaRes.count ?? 0),
  };
}

/** /api/jobs/page — 캐시 done·total + live pending/running */
export async function readWorkspaceQueueStatsForApi(workspace: string): Promise<{
  stats: QueueStatsResponse;
  queueVisibleTotal: number;
}> {
  const todayKst = formatKstDateKey(new Date());

  let { data: cached } = await supabase
    .from('huma_workspace_queue_stats')
    .select('*')
    .eq('workspace', workspace)
    .maybeSingle();

  if (!cached || cached.stats_kst_date !== todayKst) {
    cached = await recomputeAndPersistWorkspaceQueueStats(workspace);
  }

  const row = cached as WorkspaceQueueStatsRow;
  const live = await fetchLivePendingRunning(workspace);

  return {
    stats: {
      pending: live.pending,
      running: live.running,
      doneToday: row.done_today,
      doneAll: row.done_all,
    },
    queueVisibleTotal: row.queue_visible_total,
  };
}
