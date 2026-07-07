import { supabase } from '../../middleware/auth.js';
import type { NarrationAxisType, NarrationFormatType, NarrationScriptWorkspace } from '@huma/shared';

export const NARRATION_ROTATION_COOLDOWN_DAYS = 14;

export interface NarrationComboKey {
  workspace: NarrationScriptWorkspace;
  formatType: NarrationFormatType;
  axisType: NarrationAxisType;
  topicKey: string;
}

export function comboKeyString(combo: NarrationComboKey): string {
  return `${combo.workspace}|${combo.formatType}|${combo.axisType}|${combo.topicKey}`;
}

export async function listRecentBlockedCombos(
  workspace: NarrationScriptWorkspace,
  sinceDays = NARRATION_ROTATION_COOLDOWN_DAYS,
): Promise<Set<string>> {
  const since = new Date(Date.now() - sinceDays * 24 * 3_600_000).toISOString();
  const { data, error } = await supabase
    .from('huma_narration_script_history')
    .select('format_type, axis_type, topic_key')
    .eq('workspace', workspace)
    .gte('created_at', since)
    .eq('status', 'script_ready');

  if (error) throw new Error(error.message);

  const blocked = new Set<string>();
  for (const row of data ?? []) {
    blocked.add(
      comboKeyString({
        workspace,
        formatType: row.format_type as NarrationFormatType,
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

export function pickLeastUsedAxis(
  axes: NarrationAxisType[],
  usage: Map<NarrationAxisType, number>,
): NarrationAxisType {
  let best = axes[0]!;
  let bestScore = Infinity;
  for (const axis of axes) {
    const score = (usage.get(axis) ?? 0) + Math.random() * 0.1;
    if (score < bestScore) {
      bestScore = score;
      best = axis;
    }
  }
  return best;
}

export function isComboBlocked(combo: NarrationComboKey, blocked: Set<string>): boolean {
  return blocked.has(comboKeyString(combo));
}
