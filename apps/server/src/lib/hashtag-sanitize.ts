/** 네이버·SNS 해시태그 — 기술/오류/로딩 문구 금지 */

const BANNED_HASHTAG_RE =
  /(?:로딩|loading|웹페이지\s*오류|페이지\s*오류|콘텐츠\s*없|재로딩|새로고침|오류\s*발생|에러|error|failed|failure|404|500|undefined|null|fetch|timeout|network|네트워크|접속\s*불가|서버\s*오류|not\s*found|unavailable|retry|다시\s*시도)/i;

const URL_NOISE_RE =
  /(?:로딩\s*중|loading|웹페이지\s*오류|콘텐츠\s*없|재로딩|page\s*error|something\s*went\s*wrong)/i;

export function normalizeHashtagTag(raw: string): string {
  return raw.replace(/^#+/, '').replace(/\s+/g, '').trim();
}

export function isBannedHashtag(raw: string): boolean {
  const tag = normalizeHashtagTag(raw);
  if (!tag || tag.length > 30 || tag.length < 2) return true;
  return BANNED_HASHTAG_RE.test(tag);
}

export function defaultWorkspaceHashtags(workspace: string): string[] {
  if (workspace === 'quizoasis') return ['심리테스트', 'MBTI', '퀴즈'];
  if (workspace === 'panana') return ['AI캐릭터', '파나나', '감성AI'];
  return ['연운', '사주', '운세'];
}

/** Claude 출력·URL 잡음 제거 후 주제 태그만 유지 */
export function sanitizeHashtags(tags: string[], workspace: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const raw of tags) {
    const bare = normalizeHashtagTag(raw);
    if (!bare || isBannedHashtag(bare)) continue;
    const key = bare.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(bare);
    if (out.length >= 20) break;
  }

  if (out.length >= 5) return out;

  for (const seed of defaultWorkspaceHashtags(workspace)) {
    if (out.length >= 8) break;
    const key = seed.toLowerCase();
    if (!seen.has(key) && !isBannedHashtag(seed)) {
      seen.add(key);
      out.push(seed);
    }
  }

  return out.length ? out : defaultWorkspaceHashtags(workspace);
}

/** 해시태그 프롬프트용 — SPA 로딩·오류 페이지 텍스트 배제 */
export function urlContextForHashtags(urlSummary: string): string {
  const trimmed = urlSummary.trim();
  if (!trimmed) return '';

  const productBlock = trimmed.match(/\[연운 상품 정보\][\s\S]*?(?=\n\[|$)/)?.[0]?.trim();
  if (productBlock) return productBlock.slice(0, 600);

  if (URL_NOISE_RE.test(trimmed)) {
    const cleanLines = trimmed
      .split('\n')
      .map((l) => l.trim())
      .filter(
        (l) =>
          l &&
          !URL_NOISE_RE.test(l) &&
          !/^\[URL fetch 실패/i.test(l) &&
          !/^\[URL 페이지 요약\]/i.test(l) &&
          !/^\[참조 URL\]/i.test(l),
      );
    if (cleanLines.length) return cleanLines.join('\n').slice(0, 400);
    return '';
  }

  return trimmed.slice(0, 400);
}
