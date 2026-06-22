import { supabase } from '../middleware/auth.js';
import { logOperation } from './log-emitter.js';
import {
  embedText,
  maxSimilarityToHistory,
  POSTING_SIMILARITY_THRESHOLD,
} from '../modules/video-content/embedding.js';

export { POSTING_SIMILARITY_THRESHOLD };

/** 본문 유사도 비교 — 직전 N건 */
export const POSTING_BODY_COMPARE_LIMIT = 10;

export const MAX_POSTING_SIMILARITY_RETRIES = 3;

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
  /** 과거 발행 SEO 제목 전체 */
  allTitleEmbeddings: number[][];
  /** 직전 N건 본문 */
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
  const titleTooSimilar = titleSimilarity >= POSTING_SIMILARITY_THRESHOLD;
  const bodyTooSimilar = bodySimilarity >= POSTING_SIMILARITY_THRESHOLD;
  return {
    ok: !titleTooSimilar && !bodyTooSimilar,
    titleSimilarity,
    titleTooSimilar,
    bodySimilarity,
    bodyTooSimilar,
  };
}

export function buildPostingSimilarityFeedback(check: PostingSimilarityCheck): string {
  const parts: string[] = [];
  if (check.titleTooSimilar) {
    parts.push(
      `seo_title 유사도 ${check.titleSimilarity.toFixed(3)} (기준 ${POSTING_SIMILARITY_THRESHOLD}) — 과거 발행 제목과 구분되도록 키워드 배치·표현을 바꿔 32자 이내 새 제목으로 다시 작성하세요.`,
    );
  }
  if (check.bodyTooSimilar) {
    parts.push(
      `blog_post 유사도 ${check.bodySimilarity.toFixed(3)} (기준 ${POSTING_SIMILARITY_THRESHOLD}) — 주제는 유지하되 도입·전개·결말·비유·소제목을 충분히 다르게 다시 작성하세요.`,
    );
  }
  return parts.join('\n');
}

/** 계정별 완료 post_blog — 제목은 전체, 본문은 최근 N건 */
export async function loadPostingSimilarityCorpus(accountId: string): Promise<PostingSimilarityCorpus> {
  const { data, error } = await supabase
    .from('huma_jobs')
    .select('title, content, created_at')
    .eq('account_id', accountId)
    .eq('job_type', 'post_blog')
    .eq('status', 'completed')
    .not('title', 'is', null)
    .not('content', 'is', null)
    .order('created_at', { ascending: false });

  if (error) {
    await logOperation({
      level: 'warn',
      message: `[posting-similarity] 과거 발행 로드 실패 — ${error.message}`,
    });
    return { allTitleEmbeddings: [], recentBodyEmbeddings: [] };
  }

  const rows = data ?? [];
  const allTitles = rows.map((r) => String(r.title ?? '')).filter((t) => t.trim().length > 0);
  const recentBodies = rows
    .slice(0, POSTING_BODY_COMPARE_LIMIT)
    .map((r) => String(r.content ?? ''))
    .filter((b) => b.trim().length > 0);

  return {
    allTitleEmbeddings: allTitles.map((t) => embedText(t)),
    recentBodyEmbeddings: recentBodies.map((b) => embedText(b)),
  };
}
