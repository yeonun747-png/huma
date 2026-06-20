/**
 * 텍스트 유사도 — 외부 임베딩 API 없이 term-frequency + character trigram 벡터 사용.
 * HUMA에 pgvector/OpenAI 임베딩 미구축 → 순수 JS 코사인 유사도로 중복 차단.
 */

const DIM = 512;

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2);
}

function trigrams(text: string): string[] {
  const s = text.replace(/\s+/g, '');
  const out: string[] = [];
  for (let i = 0; i <= s.length - 3; i++) out.push(s.slice(i, i + 3));
  return out;
}

function hashToIndex(token: string): number {
  let h = 2166136261;
  for (let i = 0; i < token.length; i++) {
    h ^= token.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % DIM;
}

export function embedText(text: string): number[] {
  const vec = new Array(DIM).fill(0);
  const tokens = [...tokenize(text), ...trigrams(text)];
  if (!tokens.length) return vec;

  for (const tok of tokens) {
    const idx = hashToIndex(tok);
    vec[idx]! += 1;
  }

  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
  if (norm === 0) return vec;
  return vec.map((v) => v / norm);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i]! * b[i]!;
  return dot;
}

export function maxSimilarityToHistory(
  embedding: number[],
  historyEmbeddings: number[][],
): number {
  return computeSimilarityScores(embedding, historyEmbeddings).max;
}

/** 디버그용 — 각 과거 임베딩과의 코사인 유사도 */
export function computeSimilarityScores(
  embedding: number[],
  historyEmbeddings: number[][],
): { max: number; scores: number[] } {
  if (!historyEmbeddings.length) return { max: 0, scores: [] };
  const scores = historyEmbeddings.map((h) => cosineSimilarity(embedding, h));
  return { max: Math.max(...scores), scores };
}

/** Supabase JSONB embedding_vector → number[] */
export function parseEmbeddingVector(raw: unknown): number[] | null {
  if (Array.isArray(raw) && raw.length > 0 && typeof raw[0] === 'number') {
    return raw as number[];
  }
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'number') {
        return parsed as number[];
      }
    } catch {
      /* ignore */
    }
  }
  return null;
}

export const SIMILARITY_THRESHOLD = 0.85;
export const MAX_REGENERATION_ATTEMPTS = 3;
