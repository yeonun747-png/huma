import axios, { type AxiosRequestConfig } from 'axios';
import { supabase } from '../../middleware/auth.js';
import { notifyTelegram } from '../watcher/telegram.js';
import { logOperation } from '../../lib/log-emitter.js';

export interface Fortune82ProductRow {
  id: string;
  product_id: string;
  gc: number | null;
  ic: number | null;
  title: string;
  teacher_name: string | null;
  intro: string | null;
  composition: string | null;
  price: number | null;
  status: string;
  synced_at: string;
}

export interface Fortune82ApiProduct {
  id: string;
  gc?: number | null;
  ic?: number | null;
  title: string;
  teacher_name?: string | null;
  intro?: string | null;
  composition?: string | null;
  price?: number | null;
  status?: string | null;
}

const FORTUNE82_API_DEFAULT = 'https://www.fortune82.com/api/huma/products';

export function resolveFortune82ApiUrl(): string {
  return process.env.FORTUNE82_PRODUCTS_API_URL?.trim() || FORTUNE82_API_DEFAULT;
}

export function resolveFortune82ApiKey(): string | null {
  return process.env.FORTUNE82_HUMA_API_KEY?.trim() || null;
}

function normalizeFortune82Response(data: unknown): Fortune82ApiProduct[] {
  if (data == null) return [];
  let rows: unknown[] = [];
  if (Array.isArray(data)) rows = data;
  else if (typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    const nested = obj.products ?? obj.data ?? obj.items;
    if (Array.isArray(nested)) rows = nested;
  }
  const out: Fortune82ApiProduct[] = [];
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as Record<string, unknown>;
    const id = row.id;
    const title = row.title;
    if (id == null || title == null) continue;
    out.push({
      id: String(id),
      gc: typeof row.gc === 'number' ? row.gc : row.gc != null ? Number(row.gc) : null,
      ic: typeof row.ic === 'number' ? row.ic : row.ic != null ? Number(row.ic) : null,
      title: String(title),
      teacher_name: row.teacher_name != null ? String(row.teacher_name) : null,
      intro: row.intro != null ? String(row.intro) : null,
      composition: row.composition != null ? String(row.composition) : null,
      price: typeof row.price === 'number' ? row.price : row.price != null ? Number(row.price) : null,
      status: row.status != null ? String(row.status) : 'active',
    });
  }
  return out;
}

export async function fetchFortune82ProductsFromApi(): Promise<Fortune82ApiProduct[]> {
  const url = resolveFortune82ApiUrl();
  const key = resolveFortune82ApiKey();
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (key) {
    headers.Authorization = `Bearer ${key}`;
    headers['x-api-key'] = key;
  }
  const config: AxiosRequestConfig = { headers, timeout: 30_000 };
  const res = await axios.get(url, config);
  return normalizeFortune82Response(res.data);
}

export async function listActiveFortune82Products(): Promise<Fortune82ProductRow[]> {
  const { data, error } = await supabase
    .from('huma_fortune82_products_cache')
    .select('*')
    .eq('status', 'active')
    .order('title');

  if (error) throw new Error(error.message);
  return (data ?? []) as Fortune82ProductRow[];
}

export async function syncFortune82ProductsCache(): Promise<{ synced: number; error?: string }> {
  try {
    const items = await fetchFortune82ProductsFromApi();
    const now = new Date().toISOString();
    const activeIds = new Set<string>();

    for (const item of items) {
      const status = item.status === 'inactive' ? 'inactive' : 'active';
      if (status === 'active') activeIds.add(item.id);
      const { error } = await supabase.from('huma_fortune82_products_cache').upsert(
        {
          product_id: item.id,
          gc: item.gc ?? null,
          ic: item.ic ?? null,
          title: item.title,
          teacher_name: item.teacher_name ?? null,
          intro: item.intro ?? null,
          composition: item.composition ?? null,
          price: item.price ?? null,
          status,
          synced_at: now,
        },
        { onConflict: 'product_id' },
      );
      if (error) throw new Error(error.message);
    }

    const { data: existing } = await supabase.from('huma_fortune82_products_cache').select('product_id');
    for (const row of existing ?? []) {
      const pid = String(row.product_id ?? '');
      if (!pid || activeIds.has(pid)) continue;
      await supabase
        .from('huma_fortune82_products_cache')
        .update({ status: 'inactive', synced_at: now })
        .eq('product_id', pid);
    }

    await logOperation({
      level: 'info',
      message: `[fortune82-sync] 상품 ${items.length}건 동기화`,
      workspace: 'fortune82',
    });

    return { synced: items.length };
  } catch (err) {
    const msg = (err as Error).message;
    await notifyTelegram(`⚠️ 포춘82 상품 sync 실패\n${msg.slice(0, 400)}`).catch(() => undefined);
    await logOperation({
      level: 'warn',
      message: `[fortune82-sync] 실패 — ${msg}`,
      workspace: 'fortune82',
    });
    return { synced: 0, error: msg };
  }
}

export async function getFortune82LastSyncTime(): Promise<string | null> {
  const { data } = await supabase
    .from('huma_fortune82_products_cache')
    .select('synced_at')
    .order('synced_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.synced_at as string) ?? null;
}
