import type { HumaNarrationScriptHistory, NarrationScriptProgress } from '@huma/shared';
import { resolveNarrationScriptProgress } from '@huma/shared';

export type NarrationLogPayload = {
  message?: string | null;
  metadata?: Record<string, unknown> | null;
};

/** huma_logs / socket — [narration-script] 진행 단계 추출 */
export function parseNarrationScriptProgressLog(payload: NarrationLogPayload): {
  historyId?: string;
  label: string;
  percent?: number;
} | null {
  const msg = String(payload.message ?? '').trim();
  if (!msg.startsWith('[narration-script]')) return null;

  let historyId: string | undefined;
  const metaId = payload.metadata?.narration_script_history_id;
  if (typeof metaId === 'string' && metaId) historyId = metaId;

  let label = msg.replace(/^\[narration-script\]\s*/, '').trim();
  const pctMatch = label.match(/\((\d+)%\)\s*$/);
  let percent: number | undefined;
  if (pctMatch) {
    percent = Number(pctMatch[1]);
    label = label.replace(/\s*\(\d+%\)\s*$/, '').trim();
  }

  const metaPercent = payload.metadata?.progress_percent;
  if (typeof metaPercent === 'number' && Number.isFinite(metaPercent)) {
    percent = metaPercent;
  }

  const metaLabel = payload.metadata?.progress_label;
  if (typeof metaLabel === 'string' && metaLabel.trim()) {
    label = metaLabel.trim();
  }

  if (!label) return null;
  return { historyId, label, percent };
}

export function narrationProgressFromItem(
  item: Pick<HumaNarrationScriptHistory, 'source_meta' | 'created_at'>,
): ReturnType<typeof resolveNarrationScriptProgress> {
  return (
    resolveNarrationScriptProgress(item.source_meta ?? null) ?? {
      label: '대본 생성 중…',
      percent: 5,
      sinceAt: item.created_at,
    }
  );
}

const LLM_PROGRESS_STAGES = new Set(['llm_write', 'llm_retry']);

const LLM_BAND = {
  llm_write: { start: 10, end: 78, durationSec: 300 },
  llm_retry: { start: 72, end: 88, durationSec: 300 },
} as const;

/** UI 프로그레스바 — 서버 % + 구간별 시간 보간 */
export function resolveNarrationDisplayPercent(
  progress: NarrationScriptProgress,
  nowMs = Date.now(),
): number {
  const server = progress.percent;
  const stage = progress.stage ?? '';
  const elapsedSec = progress.sinceAt
    ? Math.max(0, Math.floor((nowMs - new Date(progress.sinceAt).getTime()) / 1000))
    : 0;

  const band = LLM_BAND[stage as keyof typeof LLM_BAND];
  if (band && LLM_PROGRESS_STAGES.has(stage)) {
    const updatedAt = progress.updatedAt ? new Date(progress.updatedAt).getTime() : nowMs;
    const sinceUpdateSec = Math.max(0, (nowMs - updatedAt) / 1000);
    const creep = Math.min(
      band.end - server,
      sinceUpdateSec * ((band.end - band.start) / band.durationSec),
    );
    return Math.min(band.end, Math.round(server + creep));
  }

  if (server <= 8 && elapsedSec > 0) {
    return Math.min(10, Math.max(server, 2 + Math.floor(elapsedSec / 12)));
  }

  return server;
}

export function mergeNarrationProgress(
  fromMeta: ReturnType<typeof resolveNarrationScriptProgress>,
  live: { label?: string; percent?: number } | null,
): ReturnType<typeof resolveNarrationScriptProgress> {
  if (!fromMeta && !live) return null;
  const base = fromMeta ?? { label: '대본 생성 중…', percent: 5 };
  if (!live) return base;

  const livePct =
    typeof live.percent === 'number' && Number.isFinite(live.percent)
      ? Math.min(100, Math.max(0, Math.round(live.percent)))
      : null;
  const mergedPct = livePct != null ? Math.max(base.percent, livePct) : base.percent;
  const liveLabel = live.label?.trim();
  const preferLiveLabel = livePct != null && livePct >= base.percent;

  return {
    ...base,
    label: preferLiveLabel && liveLabel ? liveLabel : base.label,
    percent: mergedPct,
  };
}
