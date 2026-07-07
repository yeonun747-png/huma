import {
  formatQuizContextForPosting,
  lookupQuizContentByExternalId,
  lookupQuizContentBySlug,
  type QuizContentRow,
} from '../video-content/quiz-content-cache.js';

/** /test/{slug} — locale 접두사(ko, en 등) 허용 */
const QUIZ_TEST_SLUG_RE = /\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?test\/([^/?#]+)/i;

const QUIZ_HOST_RE = /(?:myquizoasis|quizoasis|quizoisis)\.com/i;

export function extractQuizTestSlug(sourceUrl: string): string | null {
  const match = sourceUrl.match(QUIZ_TEST_SLUG_RE);
  if (match?.[1]) return decodeURIComponent(match[1]).trim() || null;

  try {
    const u = new URL(sourceUrl.startsWith('http') ? sourceUrl : `https://${sourceUrl}`);
    if (!QUIZ_HOST_RE.test(u.hostname)) return null;
    const fromQuery = u.searchParams.get('slug') ?? u.searchParams.get('test') ?? u.searchParams.get('id');
    return fromQuery?.trim() || null;
  } catch {
    return null;
  }
}

async function resolveQuizFromUrl(sourceUrl: string): Promise<QuizContentRow | null> {
  const slug = extractQuizTestSlug(sourceUrl);
  if (slug) {
    const bySlug = await lookupQuizContentBySlug(slug);
    if (bySlug) return bySlug;
    const byId = await lookupQuizContentByExternalId(slug);
    if (byId) return byId;
  }

  try {
    const u = new URL(sourceUrl.startsWith('http') ? sourceUrl : `https://${sourceUrl}`);
    const id = u.searchParams.get('id') ?? u.searchParams.get('quiz_id') ?? u.searchParams.get('test_id');
    if (id?.trim()) {
      return lookupQuizContentByExternalId(id.trim());
    }
  } catch {
    /* ignore */
  }

  return null;
}

export type WorkspaceSourceContext = {
  text: string;
  /** 계정관리 캐시 매칭 성공 — SPA URL fetch 생략 */
  cacheHit: boolean;
  /** fallback 본문용 — 프롬프트 메타 블록 제외 */
  fallbackExcerpt?: string;
};

/** 관련 URL → 퀴즈 캐시 컨텍스트 (포스팅 Claude용) */
export async function buildQuizOasisContextWithPrompt(sourceUrl: string): Promise<WorkspaceSourceContext> {
  const row = await resolveQuizFromUrl(sourceUrl);
  if (!row) return { text: '', cacheHit: false };
  const desc = row.description?.trim();
  const fallbackExcerpt = desc ? `${row.title.trim()}. ${desc}` : row.title.trim();
  return { text: formatQuizContextForPosting(row), cacheHit: true, fallbackExcerpt };
}
