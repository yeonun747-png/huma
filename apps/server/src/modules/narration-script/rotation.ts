import { supabase } from '../../middleware/auth.js';
import type {
  NarrationAxisType,
  NarrationFormatType,
  NarrationPeriodType,
  NarrationScriptWorkspace,
} from '@huma/shared';

/** 데일리: 일자 구분 없이 combo 순환 — cooldown 7일. 주간·월간 14일 */
export const NARRATION_ROTATION_COOLDOWN_DAYS: Record<NarrationPeriodType, number> = {
  daily: 7,
  weekly: 14,
  monthly: 14,
};

export interface NarrationComboKey {
  workspace: NarrationScriptWorkspace;
  formatType: NarrationFormatType;
  periodType: NarrationPeriodType;
  axisType: NarrationAxisType;
  topicKey: string;
}

export const ALL_FORMAT_TYPES: NarrationFormatType[] = ['full_cover', 'ranked'];

export function rotationCooldownDays(periodType: NarrationPeriodType): number {
  return NARRATION_ROTATION_COOLDOWN_DAYS[periodType];
}

export function comboKeyString(combo: NarrationComboKey): string {
  return `${combo.workspace}|${combo.formatType}|${combo.periodType}|${combo.axisType}|${combo.topicKey}`;
}

export async function listRecentBlockedCombos(
  workspace: NarrationScriptWorkspace,
  periodType: NarrationPeriodType,
): Promise<Set<string>> {
  const sinceDays = rotationCooldownDays(periodType);
  const since = new Date(Date.now() - sinceDays * 24 * 3_600_000).toISOString();
  const { data, error } = await supabase
    .from('huma_narration_script_history')
    .select('format_type, period_type, axis_type, topic_key')
    .eq('workspace', workspace)
    .eq('period_type', periodType)
    .gte('created_at', since)
    .eq('status', 'script_ready');

  if (error) throw new Error(error.message);

  const blocked = new Set<string>();
  for (const row of data ?? []) {
    blocked.add(
      comboKeyString({
        workspace,
        formatType: row.format_type as NarrationFormatType,
        periodType: (row.period_type as NarrationPeriodType) ?? periodType,
        axisType: row.axis_type as NarrationAxisType,
        topicKey: String(row.topic_key ?? ''),
      }),
    );
  }
  return blocked;
}

export async function getAxisUsageCounts(
  workspace: NarrationScriptWorkspace,
  limit = 20,
): Promise<Map<NarrationAxisType, number>> {
  const { data, error } = await supabase
    .from('huma_narration_script_history')
    .select('axis_type')
    .eq('workspace', workspace)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message);

  const counts = new Map<NarrationAxisType, number>();
  for (const row of data ?? []) {
    const axis = row.axis_type as NarrationAxisType;
    counts.set(axis, (counts.get(axis) ?? 0) + 1);
  }
  return counts;
}

export async function getFormatUsageCounts(
  workspace: NarrationScriptWorkspace,
  periodType?: NarrationPeriodType,
  limit = 20,
): Promise<Map<NarrationFormatType, number>> {
  let query = supabase
    .from('huma_narration_script_history')
    .select('format_type, period_type')
    .eq('workspace', workspace)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (periodType) {
    query = query.eq('period_type', periodType);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const counts = new Map<NarrationFormatType, number>();
  for (const row of data ?? []) {
    const format = row.format_type as NarrationFormatType;
    counts.set(format, (counts.get(format) ?? 0) + 1);
  }
  return counts;
}

export function pickLeastUsed<T extends string>(
  items: T[],
  usage: Map<T, number>,
): T {
  let best = items[0]!;
  let bestScore = Infinity;
  for (const item of items) {
    const score = (usage.get(item) ?? 0) + Math.random() * 0.1;
    if (score < bestScore) {
      bestScore = score;
      best = item;
    }
  }
  return best;
}

export function pickLeastUsedAxis(
  axes: NarrationAxisType[],
  usage: Map<NarrationAxisType, number>,
): NarrationAxisType {
  return pickLeastUsed(axes, usage);
}

export function isComboBlocked(combo: NarrationComboKey, blocked: Set<string>): boolean {
  return blocked.has(comboKeyString(combo));
}
