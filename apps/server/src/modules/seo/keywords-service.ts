import type { Workspace } from '@huma/shared';
import { DEFAULT_CRANK_KEYWORD_POOLS } from '@huma/shared';
import { supabase } from '../../middleware/auth.js';
import { getSetting } from '../../lib/settings.js';
import {
  fetchSearchConsoleTopQueries,
  isSearchConsoleConfigured,
  getMissingSearchConsoleEnvKeys,
} from './search-console.js';

export type SeoRankRow = { rank: string; word: string; vol: string; chg: string; ok: boolean | null };
export type SeoMapRow = { id: string; kw: string; cnt: number; reflect: string; st: string; tone: 'ok' | 'warn' | 'err' };

const WS_BADGE: Record<string, string> = {
  yeonun: '연운 워크스페이스',
  quizoasis: '퀴즈오아시스 워크스페이스',
  panana: '파나나 워크스페이스',
};

/** SEO·포스팅 참조용 보조 키워드 (연운 전용 — 퀴즈·파나나는 DEFAULT_CRANK_KEYWORD_POOLS 사용) */
const SEO_EXTRA_POOLS: Partial<Record<Workspace, string[]>> = {
  yeonun: ['사주풀이', '신년운세', '꿈해몽', '자미두수', '사주 궁합', '오늘 운세', '연애운', '무료 사주'],
};

function rankLabel(position: number): string {
  if (position <= 0) return '—';
  return `#${Math.round(position)}`;
}

function changeFromPosition(position: number): { chg: string; ok: boolean | null } {
  if (position <= 3) return { chg: '▲', ok: true };
  if (position <= 10) return { chg: '▲', ok: true };
  if (position <= 20) return { chg: '—', ok: null };
  return { chg: '▼', ok: false };
}

function mapTone(cnt: number): { st: string; tone: 'ok' | 'warn' | 'err' } {
  if (cnt >= 10) return { st: '최상', tone: 'ok' };
  if (cnt >= 5) return { st: '양호', tone: 'ok' };
  if (cnt >= 2) return { st: '보강', tone: 'warn' };
  return { st: '부족', tone: 'err' };
}

function normalizeSeoMapRows(rows: SeoMapRow[]): SeoMapRow[] {
  return rows.map((row) => {
    const st = row.st === '보강필요' ? '보강' : row.st;
    const reflect = row.reflect.replace(/보강필요/g, '보강');
    return st === row.st && reflect === row.reflect ? row : { ...row, st, reflect };
  });
}

/** 캐시 무효화 — 키워드풀·상태 라벨 정책 변경 시 증가 */
const SEO_POOL_VERSION = 3;

function resolveWorkspaceKeywordPool(
  ws: Workspace,
  crank: { keyword_pools?: Partial<Record<Workspace, string[]>> },
): string[] {
  // SEO UI: 퀴즈·파나나는 코드 상수가 단일 소스 (DB legacy 혼입 방지)
  if (ws === 'quizoasis' || ws === 'panana') {
    return [...DEFAULT_CRANK_KEYWORD_POOLS[ws]];
  }
  const fromDb = crank.keyword_pools?.[ws];
  if (Array.isArray(fromDb) && fromDb.length > 0) {
    return fromDb.filter(Boolean);
  }
  return [...(DEFAULT_CRANK_KEYWORD_POOLS[ws] ?? [])];
}

async function loadKeywordPool(workspace: string): Promise<string[]> {
  const ws = workspace as Workspace;
  const crank = await getSetting<{ keyword_pools?: Partial<Record<Workspace, string[]>>; keywords?: string[] }>(
    'social_crank',
    {},
  );
  const canonical = resolveWorkspaceKeywordPool(ws, crank);

  // 퀴즈·파나나: 지정 키워드풀만 표시 (연운 legacy keywords·job 태그 혼입 방지)
  if (ws === 'quizoasis' || ws === 'panana') {
    return canonical.slice(0, 24);
  }

  const legacyKw = Array.isArray(crank.keywords) ? crank.keywords : [];
  const { data: jobs } = await supabase
    .from('huma_jobs')
    .select('hashtags, title')
    .eq('workspace', workspace)
    .eq('status', 'completed')
    .order('completed_at', { ascending: false })
    .limit(50);

  const fromTags = new Set<string>();
  for (const j of jobs ?? []) {
    for (const tag of (j.hashtags as string[] | null) ?? []) {
      const t = tag.replace(/^#/, '').trim();
      if (t) fromTags.add(t);
    }
    if (j.title) {
      const words = String(j.title).split(/[\s·—\-]+/).filter((w) => w.length >= 2);
      words.slice(0, 2).forEach((w) => fromTags.add(w));
    }
  }

  return [
    ...new Set([...canonical, ...legacyKw, ...fromTags, ...(SEO_EXTRA_POOLS[ws] ?? [])]),
  ].slice(0, 24);
}

async function buildContentMap(workspace: string): Promise<SeoMapRow[]> {
  const { data: jobs } = await supabase
    .from('huma_jobs')
    .select('id, title, hashtags, status, completed_at')
    .eq('workspace', workspace)
    .in('status', ['completed', 'running', 'scheduled'])
    .order('created_at', { ascending: false })
    .limit(40);

  const groups = new Map<string, { cnt: number; title: string; id: string }>();
  for (const j of jobs ?? []) {
    const slug = String(j.title ?? j.id)
      .toLowerCase()
      .replace(/[^a-z0-9가-힣]+/g, '-')
      .slice(0, 32);
    const prev = groups.get(slug);
    if (prev) prev.cnt += 1;
    else groups.set(slug, { cnt: 1, title: String(j.title ?? slug), id: slug });
  }

  return [...groups.values()].slice(0, 8).map((g) => {
    const { st, tone } = mapTone(g.cnt);
    return {
      id: g.id,
      kw: g.title.slice(0, 28),
      cnt: g.cnt,
      reflect: `발행 ${g.cnt}건 → ${st}`,
      st,
      tone,
    };
  });
}

async function buildRanksFromJobs(workspace: string): Promise<SeoRankRow[]> {
  const pool = await loadKeywordPool(workspace);
  const { data: jobs } = await supabase
    .from('huma_jobs')
    .select('title, hashtags')
    .eq('workspace', workspace)
    .eq('status', 'completed')
    .limit(100);

  const scores = pool.map((word) => {
    let hits = 0;
    for (const j of jobs ?? []) {
      const hay = `${j.title ?? ''} ${((j.hashtags as string[] | null) ?? []).join(' ')}`.toLowerCase();
      if (hay.includes(word.toLowerCase())) hits += 1;
    }
    return { word, hits };
  });
  scores.sort((a, b) => b.hits - a.hits);

  return scores.slice(0, 8).map((s, i) => {
    const pos = s.hits > 0 ? i + 2 : i + 15;
    const { chg, ok } = changeFromPosition(pos);
    return {
      rank: rankLabel(pos),
      word: s.word,
      vol: s.hits > 0 ? `${s.hits}건 매칭` : '데이터 수집중',
      chg,
      ok,
    };
  });
}

async function buildRanksFromGsc(workspace: string): Promise<SeoRankRow[]> {
  const rows = await fetchSearchConsoleTopQueries(workspace, 8);
  return rows.map((r) => {
    const { chg, ok } = changeFromPosition(r.position);
    return {
      rank: rankLabel(r.position),
      word: r.word,
      vol: `${r.clicks.toLocaleString()} 클릭`,
      chg,
      ok,
    };
  });
}

export async function buildSeoKeywords(workspace: string) {
  const gscConfigured = isSearchConsoleConfigured(workspace);
  let ranks: SeoRankRow[];
  if (gscConfigured) {
    try {
      const gscRanks = await buildRanksFromGsc(workspace);
      ranks = gscRanks.length > 0 ? gscRanks : await buildRanksFromJobs(workspace);
    } catch {
      ranks = await buildRanksFromJobs(workspace);
    }
  } else {
    ranks = await buildRanksFromJobs(workspace);
  }
  const pool = await loadKeywordPool(workspace);
  const table = normalizeSeoMapRows(await buildContentMap(workspace));

  return {
    workspace,
    badge: WS_BADGE[workspace] ?? workspace,
    configured: gscConfigured,
    missingEnv: gscConfigured ? [] : getMissingSearchConsoleEnvKeys(workspace),
    ranks,
    pool,
    table,
    source: gscConfigured ? 'search_console' : 'jobs',
    poolVersion: SEO_POOL_VERSION,
    crawledAt: new Date().toISOString(),
  };
}

export async function crawlAndStoreSeo(workspace: string) {
  const snapshot = await buildSeoKeywords(workspace);
  await supabase.from('huma_settings').upsert({
    key: `seo_snapshot_${workspace}`,
    value: snapshot,
    updated_at: new Date().toISOString(),
  });
  return snapshot;
}

export async function getSeoKeywords(workspace: string) {
  const { data } = await supabase
    .from('huma_settings')
    .select('value, updated_at')
    .eq('key', `seo_snapshot_${workspace}`)
    .maybeSingle();

  const cached = data?.value as Record<string, unknown> | undefined;
  const cachedPool = cached?.pool;
  const cachedRanks = cached?.ranks;
  const poolOk = Array.isArray(cachedPool) && cachedPool.length > 0;
  const ranksOk = Array.isArray(cachedRanks);
  const versionOk = cached?.poolVersion === SEO_POOL_VERSION;
  if (poolOk && ranksOk && versionOk) {
    const table = Array.isArray(cached?.table)
      ? normalizeSeoMapRows(cached.table as SeoMapRow[])
      : cached?.table;
    return { ...cached, table, cachedAt: data?.updated_at };
  }
  return buildSeoKeywords(workspace);
}
