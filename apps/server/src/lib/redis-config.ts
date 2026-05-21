/** Redis 연결 URL — REDIS_URL 또는 REDIS_HOST+REDIS_PORT (v3.9 레거시 분산 워커용) */
export function resolveRedisUrl(): string {
  const direct = process.env.REDIS_URL?.trim();
  if (direct) return direct;

  const host = process.env.REDIS_HOST?.trim() ?? '127.0.0.1';
  const port = process.env.REDIS_PORT?.trim() ?? '6379';
  const password = process.env.REDIS_PASSWORD?.trim();

  if (password) {
    return `redis://:${encodeURIComponent(password)}@${host}:${port}`;
  }
  return `redis://${host}:${port}`;
}
