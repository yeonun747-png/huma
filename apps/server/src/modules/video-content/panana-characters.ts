import axios from 'axios';
import { supabase } from '../../middleware/auth.js';
import { notifyTelegram } from '../watcher/telegram.js';
import { logOperation } from '../../lib/log-emitter.js';

export interface PananaCharacterRow {
  id: string;
  panana_character_id: string;
  name: string;
  description: string | null;
  status: string;
  synced_at: string;
}

export async function syncPananaCharacters(): Promise<{ synced: number; error?: string }> {
  const apiUrl = process.env.PANANA_CHARACTER_API_URL?.trim();
  if (!apiUrl) {
    return { synced: 0, error: 'PANANA_CHARACTER_API_URL 미설정' };
  }

  try {
    const { data } = await axios.get<
      Array<{ id: string; name: string; description?: string; status?: string; updated_at?: string }>
    >(apiUrl, { timeout: 30_000 });

    const rows = Array.isArray(data) ? data : [];
    let synced = 0;

    for (const ch of rows) {
      const status = ch.status === 'inactive' ? 'inactive' : 'active';
      const { error } = await supabase.from('huma_panana_characters_cache').upsert(
        {
          panana_character_id: String(ch.id),
          name: ch.name,
          description: ch.description ?? null,
          status,
          synced_at: new Date().toISOString(),
        },
        { onConflict: 'panana_character_id' },
      );
      if (!error) synced++;
    }

    const responseIds = new Set(rows.map((r) => String(r.id)));
    const { data: cached } = await supabase
      .from('huma_panana_characters_cache')
      .select('id, panana_character_id')
      .eq('status', 'active');

    for (const row of cached ?? []) {
      if (!responseIds.has(row.panana_character_id)) {
        await supabase
          .from('huma_panana_characters_cache')
          .update({ status: 'inactive', synced_at: new Date().toISOString() })
          .eq('id', row.id);
      }
    }

    await logOperation({
      level: 'info',
      message: `[panana-sync] 캐릭터 ${synced}건 동기화 완료`,
      workspace: 'panana',
    });
    return { synced };
  } catch (err) {
    const msg = (err as Error).message;
    await notifyTelegram(
      `⚠️ 파나나 캐릭터 동기화 실패 — 최근 캐시 데이터로 계속 운영됨\n${msg}`,
      'panana',
    );
    return { synced: 0, error: msg };
  }
}

export async function listActivePananaCharacters(): Promise<PananaCharacterRow[]> {
  const { data } = await supabase
    .from('huma_panana_characters_cache')
    .select('*')
    .eq('status', 'active')
    .order('name');
  return (data ?? []) as PananaCharacterRow[];
}

export async function pickPananaCharacter(accountId: string): Promise<PananaCharacterRow | null> {
  const active = await listActivePananaCharacters();
  if (!active.length) return null;

  const { data: recent } = await supabase
    .from('huma_video_content_history')
    .select('character_used')
    .eq('account_id', accountId)
    .not('character_used', 'is', null)
    .order('created_at', { ascending: false })
    .limit(20);

  const counts = new Map<string, number>();
  for (const ch of active) counts.set(ch.id, 0);
  for (const row of recent ?? []) {
    const id = row.character_used as string;
    if (id && counts.has(id)) counts.set(id, (counts.get(id) ?? 0) + 1);
  }

  const maxCount = Math.max(...counts.values(), 0);
  const weights = active.map((ch) => {
    const c = counts.get(ch.id) ?? 0;
    return maxCount - c + 1;
  });
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < active.length; i++) {
    r -= weights[i]!;
    if (r <= 0) return active[i]!;
  }
  return active[0] ?? null;
}

export async function getCharacterAppearanceCounts(
  accountId: string,
): Promise<Map<string, number>> {
  const { data: recent } = await supabase
    .from('huma_video_content_history')
    .select('character_used')
    .eq('account_id', accountId)
    .not('character_used', 'is', null)
    .order('created_at', { ascending: false })
    .limit(20);

  const counts = new Map<string, number>();
  for (const row of recent ?? []) {
    const id = row.character_used as string;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

export async function getLastSyncTime(): Promise<string | null> {
  const { data } = await supabase
    .from('huma_panana_characters_cache')
    .select('synced_at')
    .order('synced_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.synced_at as string) ?? null;
}
