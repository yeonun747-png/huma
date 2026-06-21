import axios, { type AxiosRequestConfig } from 'axios';
import { supabase } from '../../middleware/auth.js';
import { notifyTelegram } from '../watcher/telegram.js';
import { logOperation } from '../../lib/log-emitter.js';
import { pickWeightedByCounts } from './panana-characters.js';

export interface QuizContentRow {
  id: string;
  quiz_external_id: string;
  slug: string | null;
  title: string;
  description: string | null;
  status: string;
  synced_at: string;
}

export interface QuizApiItem {
  id: string;
  slug?: string | null;
  title: string;
  description?: string | null;
  status?: string;
}

const QUIZ_CONTENT_API_DEFAULT_URL = 'https://myquizoasis.com/api/huma/quizzes';

export function normalizeQuizApiResponse(data: unknown): QuizApiItem[] {
  if (data == null) return [];

  let rows: unknown[] = [];
  if (Array.isArray(data)) {
    rows = data;
  } else if (typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    const nested = obj.quizzes ?? obj.tests ?? obj.data ?? obj.items ?? obj.results;
    if (Array.isArray(nested)) rows = nested;
  }

  const out: QuizApiItem[] = [];
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as Record<string, unknown>;

    const id = row.id ?? row.quiz_id ?? row.test_id ?? row.slug;
    const title = row.title ?? row.name ?? row.test_name;
    if (id == null || title == null) continue;

    const description =
      row.description ?? row.summary ?? row.intro ?? row.tagline ?? null;
    const slug = row.slug ?? row.test_slug ?? row.path ?? null;

    let status = 'active';
    if (row.status === 'inactive' || row.active === false) status = 'inactive';
    else if (row.status === 'active' || row.active === true) status = 'active';
    else if (typeof row.status === 'string' && row.status.trim()) status = row.status.trim();

    out.push({
      id: String(id),
      slug: slug != null ? String(slug) : null,
      title: String(title),
      description: description != null ? String(description) : null,
      status,
    });
  }
  return out;
}

function resolveQuizContentApiUrl(): string | null {
  return process.env.QUIZOASIS_CONTENT_API_URL?.trim() || null;
}

function quizApiRequestConfig(): { url: string; config: AxiosRequestConfig } | null {
  const apiUrl = resolveQuizContentApiUrl();
  if (!apiUrl) return null;

  const headers: Record<string, string> = { Accept: 'application/json' };
  const apiKey = process.env.QUIZOASIS_CONTENT_API_KEY?.trim();
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
    headers['x-api-key'] = apiKey;
  }

  const timeoutRaw = Number(process.env.QUIZOASIS_CONTENT_API_TIMEOUT_MS);
  const timeout = Number.isFinite(timeoutRaw) && timeoutRaw >= 5_000 ? timeoutRaw : 60_000;

  return { url: apiUrl, config: { timeout, headers, validateStatus: () => true } };
}

export async function fetchQuizContentFromApi(): Promise<QuizApiItem[]> {
  const req = quizApiRequestConfig();
  if (!req) throw new Error('QUIZOASIS_CONTENT_API_URL 미설정');

  let res;
  try {
    res = await axios.get<unknown>(req.url, req.config);
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    throw new Error(`퀴즈 API 요청 실패 — ${QUIZ_CONTENT_API_DEFAULT_URL} 권장: ${msg}`);
  }

  if (res.status >= 400) {
    const snippet =
      typeof res.data === 'string'
        ? res.data.slice(0, 200)
        : JSON.stringify(res.data ?? '').slice(0, 200);
    throw new Error(`퀴즈 API HTTP ${res.status}${snippet ? ` — ${snippet}` : ''}`);
  }

  const normalized = normalizeQuizApiResponse(res.data);
  if (!normalized.length && res.data != null) {
    await logOperation({
      level: 'warn',
      message: '[quiz-sync] API 응답 파싱 결과 0건 — QUIZOASIS_CONTENT_API_URL·스펙 확인',
      workspace: 'quizoasis',
    });
  }
  return normalized;
}

export function formatQuizContext(row: QuizContentRow): string {
  const slugLine = row.slug ? `slug: ${row.slug}\n` : '';
  const desc = row.description?.trim() ? `소개: ${row.description.trim()}\n` : '';
  return `[퀴즈오아시스 테스트]
${slugLine}제목: ${row.title}
${desc}(이번 영상에 자연스럽게 녹일 심리테스트 — 결과 유형·펀치라인과 연결)`;
}

export type QuizContentPick = {
  quizExternalId: string;
  slug: string | null;
  title: string;
  contextText: string;
};

export async function syncQuizContentCache(): Promise<{ synced: number; error?: string }> {
  if (!resolveQuizContentApiUrl()) {
    await logOperation({
      level: 'warn',
      message: '[quiz-sync] QUIZOASIS_CONTENT_API_URL 미설정 — 캐시 동기화 스킵',
      workspace: 'quizoasis',
    });
    return { synced: 0, error: 'QUIZOASIS_CONTENT_API_URL 미설정' };
  }

  try {
    const rows = await fetchQuizContentFromApi();
    let synced = 0;
    const now = new Date().toISOString();

    for (const quiz of rows) {
      const status = quiz.status === 'inactive' ? 'inactive' : 'active';
      const { error } = await supabase.from('huma_quiz_content_cache').upsert(
        {
          quiz_external_id: quiz.id,
          slug: quiz.slug ?? null,
          title: quiz.title,
          description: quiz.description ?? null,
          status,
          synced_at: now,
        },
        { onConflict: 'quiz_external_id' },
      );
      if (!error) synced++;
    }

    const responseIds = new Set(rows.map((r) => r.id));
    const { data: cached } = await supabase.from('huma_quiz_content_cache').select('id, quiz_external_id');

    let deactivated = 0;
    for (const row of cached ?? []) {
      if (!responseIds.has(row.quiz_external_id)) {
        await supabase
          .from('huma_quiz_content_cache')
          .update({ status: 'inactive', synced_at: now })
          .eq('id', row.id);
        deactivated++;
      }
    }

    await logOperation({
      level: 'info',
      message: `[quiz-sync] 퀴즈 ${synced}건 동기화${deactivated ? `, 비활성 ${deactivated}건` : ''}`,
      workspace: 'quizoasis',
    });
    return { synced };
  } catch (err) {
    const msg = (err as Error).message;
    await notifyTelegram(
      `⚠️ 퀴즈 콘텐츠 동기화 실패 — 최근 캐시 데이터로 계속 운영됨\n${msg}`,
      'quizoasis',
    );
    await logOperation({
      level: 'warn',
      message: `[quiz-sync] 동기화 실패: ${msg}`,
      workspace: 'quizoasis',
    });
    return { synced: 0, error: msg };
  }
}

export async function listActiveQuizContent(): Promise<QuizContentRow[]> {
  const { data } = await supabase
    .from('huma_quiz_content_cache')
    .select('*')
    .eq('status', 'active')
    .order('title');
  return (data ?? []) as QuizContentRow[];
}

async function loadRecentUsedQuizIds(limit = 20): Promise<string[]> {
  const { data } = await supabase
    .from('huma_video_content_history')
    .select('used_quiz_id')
    .eq('workspace', 'quizoasis')
    .not('used_quiz_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(limit);

  return (data ?? []).map((r) => String(r.used_quiz_id ?? '')).filter(Boolean);
}

/** workspace 최근 used_quiz_id 빈도 — 적게 쓴 퀴즈 가중치 ↑ */
export async function pickQuizContent(): Promise<QuizContentPick | null> {
  const active = await listActiveQuizContent();
  if (!active.length) {
    await logOperation({
      level: 'warn',
      message: '[quiz-pick] 활성 퀴즈 0건 — QUIZOASIS_CONTENT_API_URL·동기화 확인',
      workspace: 'quizoasis',
    });
    return null;
  }

  const recent = await loadRecentUsedQuizIds();
  const counts = new Map<string, number>();
  for (const row of active) counts.set(row.quiz_external_id, 0);
  for (const id of recent) {
    if (counts.has(id)) counts.set(id, (counts.get(id) ?? 0) + 1);
  }

  const picked = pickWeightedByCounts(
    active.map((q) => ({ id: q.quiz_external_id, row: q })),
    counts,
  );
  if (!picked) return null;

  return {
    quizExternalId: picked.row.quiz_external_id,
    slug: picked.row.slug,
    title: picked.row.title,
    contextText: formatQuizContext(picked.row),
  };
}

export async function getQuizUsageCounts(): Promise<Map<string, number>> {
  const recent = await loadRecentUsedQuizIds();
  const counts = new Map<string, number>();
  for (const id of recent) counts.set(id, (counts.get(id) ?? 0) + 1);
  return counts;
}

export async function getQuizContentLastSyncTime(): Promise<string | null> {
  const { data } = await supabase
    .from('huma_quiz_content_cache')
    .select('synced_at')
    .order('synced_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.synced_at as string) ?? null;
}
