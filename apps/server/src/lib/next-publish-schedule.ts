import { supabase } from '../middleware/auth.js';

/** 큐 post_blog/content_full 예약 + 자동발행 다음 슬롯 중 가장 가까운 미래 시각 */
export async function resolveEarliestNextPublishAt(workspaces: string[]): Promise<string | null> {
  if (!workspaces.length) return null;

  const nowIso = new Date().toISOString();
  const candidates: string[] = [];

  const { data: nextJob } = await supabase
    .from('huma_jobs')
    .select('scheduled_at')
    .in('workspace', workspaces)
    .in('status', ['pending', 'scheduled'])
    .not('scheduled_at', 'is', null)
    .gt('scheduled_at', nowIso)
    .order('scheduled_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (nextJob?.scheduled_at) {
    candidates.push(String(nextJob.scheduled_at));
  }

  const { data: autoRows } = await supabase
    .from('huma_accounts')
    .select('auto_publish_next_slot_at')
    .in('workspace', workspaces)
    .eq('account_type', 'posting')
    .eq('is_active', true)
    .eq('auto_publish_enabled', true)
    .not('auto_publish_next_slot_at', 'is', null)
    .gt('auto_publish_next_slot_at', nowIso);

  for (const row of autoRows ?? []) {
    const at = row.auto_publish_next_slot_at;
    if (at) candidates.push(String(at));
  }

  if (!candidates.length) return null;

  return candidates.sort((a, b) => new Date(a).getTime() - new Date(b).getTime())[0] ?? null;
}
