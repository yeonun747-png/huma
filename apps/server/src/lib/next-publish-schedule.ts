import { supabase } from '../middleware/auth.js';

export type EarliestNextPublish = {
  at: string | null;
  account_id: string | null;
};

/** 큐 post_blog/content_full 예약 + 자동발행 다음 슬롯 중 가장 가까운 미래 시각·계정 */
export async function resolveEarliestNextPublish(workspaces: string[]): Promise<EarliestNextPublish> {
  if (!workspaces.length) return { at: null, account_id: null };

  const nowIso = new Date().toISOString();
  const candidates: { at: string; account_id: string | null }[] = [];

  const { data: nextJob } = await supabase
    .from('huma_jobs')
    .select('scheduled_at, account_id')
    .in('workspace', workspaces)
    .in('status', ['pending', 'scheduled'])
    .not('scheduled_at', 'is', null)
    .gt('scheduled_at', nowIso)
    .order('scheduled_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (nextJob?.scheduled_at) {
    candidates.push({
      at: String(nextJob.scheduled_at),
      account_id: nextJob.account_id ? String(nextJob.account_id) : null,
    });
  }

  const { data: autoRows } = await supabase
    .from('huma_accounts')
    .select('id, auto_publish_next_slot_at')
    .in('workspace', workspaces)
    .eq('account_type', 'posting')
    .eq('is_active', true)
    .eq('auto_publish_enabled', true)
    .not('auto_publish_next_slot_at', 'is', null)
    .gt('auto_publish_next_slot_at', nowIso);

  for (const row of autoRows ?? []) {
    const at = row.auto_publish_next_slot_at;
    if (at) {
      candidates.push({
        at: String(at),
        account_id: row.id ? String(row.id) : null,
      });
    }
  }

  if (!candidates.length) return { at: null, account_id: null };

  const earliest = candidates.sort(
    (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime(),
  )[0]!;
  return { at: earliest.at, account_id: earliest.account_id };
}

/** 큐 post_blog/content_full 예약 + 자동발행 다음 슬롯 중 가장 가까운 미래 시각 */
export async function resolveEarliestNextPublishAt(workspaces: string[]): Promise<string | null> {
  const next = await resolveEarliestNextPublish(workspaces);
  return next.at;
}
