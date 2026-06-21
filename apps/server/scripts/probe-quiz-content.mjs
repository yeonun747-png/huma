#!/usr/bin/env node
/**
 * 퀴즈오아시스 콘텐츠 API 프로브 — HUMA sync adapter·401 진단용
 *
 * 사용:
 *   cd apps/server
 *   QUIZOASIS_CONTENT_API_URL=https://myquizoasis.com/api/huma/quizzes \
 *   QUIZOASIS_CONTENT_API_KEY=your_key \
 *   node scripts/probe-quiz-content.mjs
 */
import { config } from 'dotenv';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
config({ path: join(here, '..', '.env') });

const url =
  process.env.QUIZOASIS_CONTENT_API_URL?.trim() ||
  'https://myquizoasis.com/api/huma/quizzes';
const apiKey =
  process.env.QUIZOASIS_CONTENT_API_KEY?.trim() ||
  process.env.QUIZOASIS_HUMA_API_KEY?.trim();

const headers = { Accept: 'application/json' };
if (apiKey) {
  headers.Authorization = `Bearer ${apiKey}`;
  headers['x-api-key'] = apiKey;
}

console.log('GET', url);
console.log(
  'Auth:',
  apiKey ? `Bearer + x-api-key (${apiKey.slice(0, 4)}…)` : '(none — 401 예상)',
);
if (!apiKey) {
  console.log(
    'Hint: i7 .env QUIZOASIS_CONTENT_API_KEY = 퀴즈 Vercel QUIZOASIS_HUMA_API_KEY',
  );
}

let res;
try {
  res = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
} catch (err) {
  console.error('fetch failed:', err instanceof Error ? err.message : err);
  process.exit(1);
}

const text = await res.text();
console.log('HTTP', res.status, res.statusText);
console.log('--- body (first 4000 chars) ---');
console.log(text.slice(0, 4000));

if (res.status === 401) {
  console.log('--- 401 진단 ---');
  if (!apiKey) {
    console.log('원인: HUMA i7 .env 에 QUIZOASIS_CONTENT_API_KEY 없음');
  } else {
    console.log('원인: 키 불일치 — 퀴즈 Vercel QUIZOASIS_HUMA_API_KEY 와 동일한지 확인');
  }
  process.exit(1);
}

let parsed;
try {
  parsed = JSON.parse(text);
} catch {
  process.exit(res.ok ? 0 : 1);
}

function previewNormalize(data) {
  let rows = [];
  if (Array.isArray(data)) rows = data;
  else if (data && typeof data === 'object') {
    const nested = data.quizzes ?? data.tests ?? data.data ?? data.items ?? data.results;
    if (Array.isArray(nested)) rows = nested;
  }
  const out = [];
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') continue;
    const id = raw.id ?? raw.quiz_id ?? raw.test_id ?? raw.slug;
    const title = raw.title ?? raw.name ?? raw.test_name;
    if (id == null || title == null) continue;
    out.push({
      id: String(id),
      title: String(title),
      slug: raw.slug ?? raw.test_slug ?? null,
    });
  }
  return out;
}

const normalized = previewNormalize(parsed);
console.log('--- normalized preview ---');
console.log(`count: ${normalized.length}`);
for (const q of normalized.slice(0, 5)) console.log(' ', q);

process.exit(res.ok ? 0 : 1);
