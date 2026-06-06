type CacheEntry = { data: unknown; expires: number };

const store = new Map<string, CacheEntry>();

export async function cachedFetch<T>(
  key: string,
  ttlMs: number,
  fetcher: () => Promise<T>,
  opts?: { force?: boolean },
): Promise<T> {
  if (!opts?.force) {
    const hit = store.get(key);
    if (hit && hit.expires > Date.now()) return hit.data as T;
  }
  const data = await fetcher();
  store.set(key, { data, expires: Date.now() + ttlMs });
  return data;
}

export function invalidateApiCache(prefix?: string): void {
  if (!prefix) {
    store.clear();
    return;
  }
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}
