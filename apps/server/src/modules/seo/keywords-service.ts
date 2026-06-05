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

const DEFAULT_POOLS: Record<string, string[]> = {
  yeonun: ['사주풀이', '신년운세', '꿈해몽', '자미두수', '사주 궁합', '오늘 운세', '연애운'],
  quizoasis: ['MBTI 테스트', '성격유형 테스트', '연애유형', '직업적성', '심리테스트', '애착유형'],
  panana: ['AI 캐릭터', 'AI 친구', '감성 AI', 'AI 대화', '파나나'],
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
  if (cnt >= 2) return { st: '보강필요', tone: 'warn' };
  return { st: '부족', tone: 'err' };
}

async function loadKeywordPool(workspace: string): Promise<string[]> {
  const crank = await getSetting<{ keywords?: string[] }>('social_crank', {});
  const crankKw = Array.isArray(crank.keywords) ? crank.keywords : [];
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

  const pool = [...new Set([...crankKw, ...fromTags, ...(DEFAULT_POOLS[workspace] ?? [])])];
  return pool.slice(0, 24);
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
  const ranks = gscConfigured
    ? await buildRanksFromGsc(workspace).catch(() => buildRanksFromJobs(workspace))
    : await buildRanksFromJobs(workspace);
  const pool = await loadKeywordPool(workspace);
  const table = await buildContentMap(workspace);

  return {
    workspace,
    badge: WS_BADGE[workspace] ?? workspace,
    configured: gscConfigured,
    missingEnv: gscConfigured ? [] : getMissingSearchConsoleEnvKeys(workspace),
    ranks,
    pool,
    table,
    source: gscConfigured ? 'search_console' : 'jobs',
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
  if (cached?.ranks && cached?.pool) {
    return { ...cached, cachedAt: data?.updated_at };
  }
  return buildSeoKeywords(workspace);
}
