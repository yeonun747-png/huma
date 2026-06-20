import axios, { type AxiosRequestConfig } from 'axios';
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

/** 외부 파나나 API 단일 캐릭터 (정규화 후) */
export interface PananaApiCharacter {
  id: string;
  name: string;
  description?: string | null;
  status?: string;
}

/** API 응답 형태 차이 대응 — 배열 / { characters } / { data } / 필드명 별칭 */
export function normalizePananaApiResponse(data: unknown): PananaApiCharacter[] {
  if (data == null) return [];

  let rows: unknown[] = [];
  if (Array.isArray(data)) {
    rows = data;
  } else if (typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    const nested = obj.characters ?? obj.data ?? obj.items ?? obj.results;
    if (Array.isArray(nested)) rows = nested;
  }

  const out: PananaApiCharacter[] = [];
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as Record<string, unknown>;

    const id =
      row.id ??
      row.panana_character_id ??
      row.character_id ??
      row.characterId ??
      row.slug;
    const name = row.name ?? row.title ?? row.character_name;
    if (id == null || name == null) continue;

    const description =
      row.description ??
      row.tagline ??
      row.bio ??
      row.intro ??
      row.personalitySummary ??
      null;

    let status = 'active';
    if (row.status === 'inactive' || row.active === false) status = 'inactive';
    else if (row.status === 'active' || row.active === true) status = 'active';
    else if (typeof row.status === 'string' && row.status.trim()) status = row.status.trim();

    out.push({
      id: String(id),
      name: String(name),
      description: description != null ? String(description) : null,
      status,
    });
  }
  return out;
}

const PANANA_CHARACTER_API_DEFAULT_URL = 'https://panana.kr/api/huma/characters';

function resolvePananaCharacterApiUrl(): string | null {
  let apiUrl = process.env.PANANA_CHARACTER_API_URL?.trim();
  if (!apiUrl) return null;
  if (/panana\.app/i.test(apiUrl)) {
    apiUrl = apiUrl.replace(/panana\.app/gi, 'panana.kr');
  }
  return apiUrl;
}

function pananaApiTimeoutMs(): number {
  const raw = Number(process.env.PANANA_CHARACTER_API_TIMEOUT_MS);
  return Number.isFinite(raw) && raw >= 5_000 ? raw : 60_000;
}

function pananaApiRequestConfig(): { url: string; config: AxiosRequestConfig } | null {
  const apiUrl = resolvePananaCharacterApiUrl();
  if (!apiUrl) return null;

  const headers: Record<string, string> = { Accept: 'application/json' };
  const apiKey = process.env.PANANA_CHARACTER_API_KEY?.trim();
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
    headers['x-api-key'] = apiKey;
  }

  return {
    url: apiUrl,
    config: { timeout: pananaApiTimeoutMs(), headers, validateStatus: () => true },
  };
}

function formatPananaApiFetchError(err: unknown): string {
  const ax = err as { code?: string; message?: string };
  const msg = ax.message ?? String(err);
  if (ax.code === 'ECONNABORTED' || /timeout/i.test(msg)) {
    return `파나나 캐릭터 API 타임아웃 — URL을 ${PANANA_CHARACTER_API_DEFAULT_URL} 로 설정했는지 확인 (panana.app 는 연결 불가)`;
  }
  if (ax.code === 'ENOTFOUND' || ax.code === 'EAI_AGAIN') {
    return `파나나 캐릭터 API DNS 실패 — ${PANANA_CHARACTER_API_DEFAULT_URL} 권장`;
  }
  return msg;
}

export async function fetchPananaCharactersFromApi(): Promise<PananaApiCharacter[]> {
  const req = pananaApiRequestConfig();
  if (!req) throw new Error('PANANA_CHARACTER_API_URL 미설정');

  let res;
  try {
    res = await axios.get<unknown>(req.url, req.config);
  } catch (err) {
    throw new Error(formatPananaApiFetchError(err));
  }
  if (res.status >= 400) {
    const snippet =
      typeof res.data === 'string'
        ? res.data.slice(0, 200)
        : JSON.stringify(res.data ?? '').slice(0, 200);
    throw new Error(`파나나 캐릭터 API HTTP ${res.status}${snippet ? ` — ${snippet}` : ''}`);
  }

  const normalized = normalizePananaApiResponse(res.data);
  if (!normalized.length && res.data != null) {
    await logOperation({
      level: 'warn',
      message: '[panana-sync] API 응답 파싱 결과 0건 — 스펙·adapter 확인 (probe-panana-characters.mjs)',
      workspace: 'panana',
    });
  }
  return normalized;
}

/** 최근 N건 빈도 기반 가중 랜덤 (적게 등장한 항목 가중치 ↑) */
export function pickWeightedByCounts<T extends { id: string }>(
  items: T[],
  counts: Map<string, number>,
): T | null {
  if (!items.length) return null;

  const maxCount = Math.max(...items.map((ch) => counts.get(ch.id) ?? 0), 0);
  const weights = items.map((ch) => maxCount - (counts.get(ch.id) ?? 0) + 1);
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i]!;
    if (r <= 0) return items[i]!;
  }
  return items[0] ?? null;
}

export async function syncPananaCharacters(): Promise<{ synced: number; error?: string }> {
  if (!process.env.PANANA_CHARACTER_API_URL?.trim()) {
    await logOperation({
      level: 'warn',
      message: '[panana-sync] PANANA_CHARACTER_API_URL 미설정 — 캐시 동기화 스킵',
      workspace: 'panana',
    });
    return { synced: 0, error: 'PANANA_CHARACTER_API_URL 미설정' };
  }

  try {
    const rows = await fetchPananaCharactersFromApi();
    let synced = 0;
    const now = new Date().toISOString();

    for (const ch of rows) {
      const status = ch.status === 'inactive' ? 'inactive' : 'active';
      const { error } = await supabase.from('huma_panana_characters_cache').upsert(
        {
          panana_character_id: ch.id,
          name: ch.name,
          description: ch.description ?? null,
          status,
          synced_at: now,
        },
        { onConflict: 'panana_character_id' },
      );
      if (!error) synced++;
    }

    const responseIds = new Set(rows.map((r) => r.id));
    const { data: cached } = await supabase
      .from('huma_panana_characters_cache')
      .select('id, panana_character_id')
      .eq('status', 'active');

    let deactivated = 0;
    for (const row of cached ?? []) {
      if (!responseIds.has(row.panana_character_id)) {
        await supabase
          .from('huma_panana_characters_cache')
          .update({ status: 'inactive', synced_at: now })
          .eq('id', row.id);
        deactivated++;
      }
    }

    await logOperation({
      level: 'info',
      message: `[panana-sync] 캐릭터 ${synced}건 동기화 완료${deactivated ? `, 비활성 ${deactivated}건` : ''}`,
      workspace: 'panana',
    });
    return { synced };
  } catch (err) {
    const msg = (err as Error).message;
    await notifyTelegram(
      `⚠️ 파나나 캐릭터 동기화 실패 — 최근 캐시 데이터로 계속 운영됨\n${msg}`,
      'panana',
    );
    await logOperation({
      level: 'warn',
      message: `[panana-sync] 동기화 실패: ${msg}`,
      workspace: 'panana',
    });
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
  if (!active.length) {
    await logOperation({
      level: 'warn',
      message: `[panana-pick] 활성 캐릭터 0건 (account=${accountId}) — 동기화 또는 PANANA_CHARACTER_API_URL 확인`,
      workspace: 'panana',
    });
    return null;
  }

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

  return pickWeightedByCounts(active, counts);
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
