import { supabase } from '../middleware/auth.js';
import { logOperation } from './log-emitter.js';
import {
  embedText,
  maxSimilarityToHistory,
  POSTING_SIMILARITY_THRESHOLD,
} from '../modules/video-content/embedding.js';

export { POSTING_SIMILARITY_THRESHOLD };

/** SEO 제목 유사도 재생성 기준 (본문은 POSTING_SIMILARITY_THRESHOLD) */
export const POSTING_TITLE_SIMILARITY_THRESHOLD = 0.65;

/** 본문 유사도 비교 — 직전 N건 (계정별) */
export const POSTING_BODY_COMPARE_LIMIT = 10;

/** 제목 임베딩 상한 — 워크스페이스 전체 최근 N건 */
export const POSTING_TITLE_COMPARE_LIMIT = 300;

/** 본문 — 최초 생성 후 재생성 상한 1회 */
export const MAX_POSTING_BODY_SIMILARITY_RETRIES = 1;

/** 제목 — 0.65 이하까지 LLM 재생성 (과거 50회는 8분+ 지연 유발) */
export const MAX_POSTING_TITLE_SIMILARITY_ATTEMPTS = 8;

/** 이 횟수 이후 LLM 대신 휴리스틱 제목 변형 시도 */
export const POSTING_TITLE_HEURISTIC_FALLBACK_AFTER = 4;

/** @deprecated MAX_POSTING_BODY_SIMILARITY_RETRIES 사용 */
export const MAX_POSTING_SIMILARITY_RETRIES = MAX_POSTING_BODY_SIMILARITY_RETRIES;

/** 제목 예약으로 볼 상태 — 미발행(scheduled 등)도 검색 중복 방지에 포함 */
export const POSTING_TITLE_RESERVED_STATUSES = [
  'completed',
  'pending',
  'scheduled',
  'running',
] as const;

/** 요구: 기준 초과 시 재생성 → 기준 이하(이내) 통과 */
export function isPostingTitleSimilarityTooHigh(score: number): boolean {
  return score > POSTING_TITLE_SIMILARITY_THRESHOLD;
}

export function isPostingSimilarityTooHigh(score: number): boolean {
  return score > POSTING_SIMILARITY_THRESHOLD;
}

export function maxPostingTitleSimilarity(title: string, pastTitleEmbeddings: number[][]): number {
  if (!pastTitleEmbeddings.length) return 0;
  const embedding = embedText(title);
  return maxSimilarityToHistory(embedding, pastTitleEmbeddings);
}

export function maxPostingBodySimilarity(body: string, pastBodyEmbeddings: number[][]): number {
  if (!pastBodyEmbeddings.length) return 0;
  const embedding = embedText(body);
  return maxSimilarityToHistory(embedding, pastBodyEmbeddings);
}

export interface PostingSimilarityCorpus {
  /** 워크스페이스 전체 SEO 제목 (최근 N건) */
  allTitleEmbeddings: number[][];
  /** 계정 직전 N건 본문 */
  recentBodyEmbeddings: number[][];
}

export interface PostingSimilarityCheck {
  ok: boolean;
  titleSimilarity: number;
  titleTooSimilar: boolean;
  bodySimilarity: number;
  bodyTooSimilar: boolean;
}

export function checkPostingSimilarity(
  seoTitle: string,
  blogPost: string,
  corpus: PostingSimilarityCorpus,
): PostingSimilarityCheck {
  const titleSimilarity = maxPostingTitleSimilarity(seoTitle, corpus.allTitleEmbeddings);
  const bodySimilarity = maxPostingBodySimilarity(blogPost, corpus.recentBodyEmbeddings);
  const titleTooSimilar = isPostingTitleSimilarityTooHigh(titleSimilarity);
  const bodyTooSimilar = isPostingSimilarityTooHigh(bodySimilarity);
  return {
    ok: !titleTooSimilar && !bodyTooSimilar,
    titleSimilarity,
    titleTooSimilar,
    bodySimilarity,
    bodyTooSimilar,
  };
}

export function buildPostingTitleSimilarityFeedback(check: PostingSimilarityCheck): string {
  return `seo_title 유사도 ${check.titleSimilarity.toFixed(3)} (기준 ${POSTING_TITLE_SIMILARITY_THRESHOLD} 초과) — 과거 발행 제목과 구분되도록 키워드 배치·표현을 바꿔 32자 이내 새 제목으로 다시 작성하세요.`;
}

export function buildPostingBodySimilarityFeedback(check: PostingSimilarityCheck): string {
  return `blog_post 유사도 ${check.bodySimilarity.toFixed(3)} (기준 ${POSTING_SIMILARITY_THRESHOLD} 초과) — 주제는 유지하되 도입·전개·결말·비유·소제목을 충분히 다르게 다시 작성하세요.`;
}

export function buildPostingSimilarityFeedback(check: PostingSimilarityCheck): string {
  const parts: string[] = [];
  if (check.titleTooSimilar) parts.push(buildPostingTitleSimilarityFeedback(check));
  if (check.bodyTooSimilar) parts.push(buildPostingBodySimilarityFeedback(check));
  return parts.join('\n');
}

export type PostingSimilaritySkipKind = 'body' | 'title' | 'corpus_load';

/** 유사도 재생성 상한 초과·코퍼스 로드 실패 — 발행 스킵(워커 정상 완료) */
export class PostingSimilaritySkipError extends Error {
  readonly code = 'POSTING_SIMILARITY_SKIP' as const;

  constructor(
    message: string,
    public readonly check: PostingSimilarityCheck,
    public readonly regenerations: number,
    public readonly skipKind: PostingSimilaritySkipKind,
  ) {
    super(message);
    this.name = 'PostingSimilaritySkipError';
  }

  /** @deprecated regenerations 사용 */
  get bodyRegenerations(): number {
    return this.skipKind === 'body' ? this.regenerations : 0;
  }
}

export function isPostingSimilaritySkipError(err: unknown): err is PostingSimilaritySkipError {
  return err instanceof PostingSimilaritySkipError;
}

export class PostingSimilarityCorpusLoadError extends Error {
  readonly code = 'POSTING_SIMILARITY_CORPUS_LOAD' as const;

  constructor(message: string) {
    super(message);
    this.name = 'PostingSimilarityCorpusLoadError';
  }
}

function uniqueNonEmptyTitles(rows: Array<{ title?: unknown }>): string[] {
  const seen = new Set<string>();
  const titles: string[] = [];
  for (const row of rows) {
    const title = String(row.title ?? '').trim();
    if (!title) continue;
    const key = title.replace(/\s+/g, ' ').toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    titles.push(title);
    if (titles.length >= POSTING_TITLE_COMPARE_LIMIT) break;
  }
  return titles;
}

function rowsToBodyEmbeddings(rows: Array<{ content?: unknown }>): number[][] {
  return rows
    .slice(0, POSTING_BODY_COMPARE_LIMIT)
    .map((r) => String(r.content ?? ''))
    .filter((b) => b.trim().length > 0)
    .map((b) => embedText(b));
}

/**
 * 제목: 워크스페이스 전체 post_blog (완료+예약/대기 포함) — 계정 간 동일 제목 차단
 * 본문: 해당 계정 완료분 최근 N건
 */
export async function loadPostingSimilarityCorpus(
  accountId: string,
  workspace: string,
): Promise<PostingSimilarityCorpus> {
  const ws = workspace.trim();
  const acc = accountId.trim();
  if (!ws || !acc) {
    throw new PostingSimilarityCorpusLoadError(
      '포스팅 유사도 코퍼스 로드 실패 — workspace/accountId 없음',
    );
  }

  const [titleResult, bodyResult] = await Promise.all([
    supabase
      .from('huma_jobs')
      .select('title, created_at')
      .eq('workspace', ws)
      .eq('job_type', 'post_blog')
      .in('status', [...POSTING_TITLE_RESERVED_STATUSES])
      .not('title', 'is', null)
      .order('created_at', { ascending: false })
      .limit(POSTING_TITLE_COMPARE_LIMIT * 2),
    supabase
      .from('huma_jobs')
      .select('content, created_at')
      .eq('account_id', acc)
      .eq('job_type', 'post_blog')
      .eq('status', 'completed')
      .not('content', 'is', null)
      .order('created_at', { ascending: false })
      .limit(POSTING_BODY_COMPARE_LIMIT),
  ]);

  if (titleResult.error) {
    await logOperation({
      level: 'error',
      message: `[posting-similarity] 워크스페이스 제목 로드 실패 — ${titleResult.error.message}`,
    });
    throw new PostingSimilarityCorpusLoadError(
      `포스팅 유사도 코퍼스 로드 실패 — 발행 중단 (${titleResult.error.message})`,
    );
  }
  if (bodyResult.error) {
    await logOperation({
      level: 'error',
      message: `[posting-similarity] 계정 본문 로드 실패 — ${bodyResult.error.message}`,
    });
    throw new PostingSimilarityCorpusLoadError(
      `포스팅 유사도 코퍼스 로드 실패 — 발행 중단 (${bodyResult.error.message})`,
    );
  }

  const titles = uniqueNonEmptyTitles(titleResult.data ?? []);
  return {
    allTitleEmbeddings: titles.map((t) => embedText(t)),
    recentBodyEmbeddings: rowsToBodyEmbeddings(bodyResult.data ?? []),
  };
}

/** 승격·최종 검증 — 미달 시 throw */
export function assertPostingSimilarityPasses(
  seoTitle: string,
  blogPost: string,
  corpus: PostingSimilarityCorpus,
): PostingSimilarityCheck {
  const check = checkPostingSimilarity(seoTitle, blogPost, corpus);
  if (!check.ok) {
    const parts: string[] = [];
    if (check.titleTooSimilar) {
      parts.push(`SEO 제목 유사도 ${check.titleSimilarity.toFixed(3)} > ${POSTING_TITLE_SIMILARITY_THRESHOLD}`);
    }
    if (check.bodyTooSimilar) {
      parts.push(`본문 유사도 ${check.bodySimilarity.toFixed(3)} > ${POSTING_SIMILARITY_THRESHOLD}`);
    }
    throw new Error(`유사도 기준 미달 — ${parts.join(' · ')}`);
  }
  return check;
}

/** KST 오늘 유사도 스킵된 content_full 건수 */
export async function countTodaySimilaritySkipped(accountId: string, sinceIso: string): Promise<number> {
  const key = accountId.trim();
  if (!key) return 0;

  const { count, error } = await supabase
    .from('huma_jobs')
    .select('*', { count: 'exact', head: true })
    .eq('account_id', key)
    .eq('job_type', 'content_full')
    .eq('status', 'completed')
    .gte('completed_at', sinceIso)
    .filter('platform_schedule->>_similarity_skipped', 'eq', 'true');

  if (error) throw new Error(`유사도 스킵 집계 실패: ${error.message}`);
  return count ?? 0;
}
