import type { HumaNarrationScriptHistory } from '@huma/shared';
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

export function mergeNarrationProgress(
  fromMeta: ReturnType<typeof resolveNarrationScriptProgress>,
  live: { label?: string; percent?: number } | null,
): ReturnType<typeof resolveNarrationScriptProgress> {
  if (!fromMeta && !live) return null;
  const base = fromMeta ?? { label: '대본 생성 중…', percent: 5 };
  if (!live) return base;
  return {
    ...base,
    label: live.label?.trim() || base.label,
    percent:
      typeof live.percent === 'number' && Number.isFinite(live.percent)
        ? Math.min(100, Math.max(0, Math.round(live.percent)))
        : base.percent,
  };
}
