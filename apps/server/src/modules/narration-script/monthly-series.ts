import { supabase } from '../../middleware/auth.js';
import type { NarrationComboKey } from './rotation.js';
import { kstMonthBoundaries } from './date-context.js';

/** 동일 월·조합의 이번 달 N편 (생성 중인 historyId 포함) */
export async function resolveMonthlySeriesEpisode(
  combo: NarrationComboKey,
  refDate: Date = new Date(),
): Promise<number> {
  const { startIso, endIso } = kstMonthBoundaries(refDate);
  const { count, error } = await supabase
    .from('huma_narration_script_history')
    .select('id', { count: 'exact', head: true })
    .eq('workspace', combo.workspace)
    .eq('period_type', 'monthly')
    .eq('format_type', 'ranked')
    .eq('axis_type', combo.axisType)
    .eq('topic_key', combo.topicKey)
    .gte('created_at', startIso)
    .lt('created_at', endIso)
    .neq('status', 'failed');

  if (error) throw new Error(error.message);
  return Math.max(1, count ?? 1);
}

export function formatMonthlySeriesLabel(episode: number, topN: number): string {
  return `이달 TOP${topN} 시리즈 ${episode}편`;
}
