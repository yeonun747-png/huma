#!/usr/bin/env node
/**
 * 파나나 캐릭터 API 응답 프로브 — HUMA sync adapter 검증용
 *
 * 사용:
 *   cd apps/server
 *   PANANA_CHARACTER_API_URL=https://panana.kr/api/huma/characters \
 *   PANANA_CHARACTER_API_KEY=your_key \
 *   node scripts/probe-panana-characters.mjs
 *
 * .env 로드: apps/server/.env (dotenv)
 */
import { config } from 'dotenv';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
config({ path: join(here, '..', '.env') });

const url = process.env.PANANA_CHARACTER_API_URL?.trim();
const apiKey = process.env.PANANA_CHARACTER_API_KEY?.trim();

if (!url) {
  console.error('PANANA_CHARACTER_API_URL 미설정');
  process.exit(1);
}

const headers = { Accept: 'application/json' };
if (apiKey) {
  headers.Authorization = `Bearer ${apiKey}`;
  headers['x-api-key'] = apiKey;
}

console.log('GET', url);
console.log('Auth:', apiKey ? 'Bearer + x-api-key' : '(none)');

let res;
try {
  res = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
} catch (err) {
  console.error('fetch failed:', err instanceof Error ? err.message : err);
  process.exit(1);
}

const text = await res.text();
console.log('HTTP', res.status, res.statusText);
console.log('Content-Type:', res.headers.get('content-type') ?? '—');
console.log('--- body (first 4000 chars) ---');
console.log(text.slice(0, 4000));

let parsed;
try {
  parsed = JSON.parse(text);
} catch {
  console.log('--- JSON parse: FAIL ---');
  process.exit(res.ok ? 0 : 1);
}

console.log('--- JSON parse: OK ---');
console.log('top-level type:', Array.isArray(parsed) ? 'array' : typeof parsed);
if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
  console.log('keys:', Object.keys(parsed).join(', '));
}

// HUMA adapter와 동일한 정규화 미리보기
function previewNormalize(data) {
  let rows = [];
  if (Array.isArray(data)) rows = data;
  else if (data && typeof data === 'object') {
    const nested = data.characters ?? data.data ?? data.items ?? data.results;
    if (Array.isArray(nested)) rows = nested;
  }
  const out = [];
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') continue;
    const id = raw.id ?? raw.panana_character_id ?? raw.character_id ?? raw.slug;
    const name = raw.name ?? raw.title;
    if (id == null || name == null) continue;
    out.push({ id: String(id), name: String(name), status: raw.status ?? (raw.active === false ? 'inactive' : 'active') });
  }
  return out;
}

const normalized = previewNormalize(parsed);
console.log('--- normalized preview ---');
console.log(`count: ${normalized.length}`);
for (const ch of normalized.slice(0, 5)) {
  console.log(' ', ch);
}
if (normalized.length > 5) console.log(` ... +${normalized.length - 5} more`);

process.exit(res.ok ? 0 : 1);
