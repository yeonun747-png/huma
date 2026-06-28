export const SEO_TITLE_MAX_LEN = 32;

/** SEO 제목 — 한글·숫자·공백만 (|, ·, 영문, 특수문자 제거) */
export function sanitizeKoreanSeoTitle(raw: string): string {
  const cleaned = raw
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[^가-힣0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return truncateKoreanSeoTitle(cleaned || '블로그 포스팅');
}

export function truncateKoreanSeoTitle(s: string): string {
  const t = s.trim().replace(/\s+/g, ' ');
  if (t.length <= SEO_TITLE_MAX_LEN) return t;
  const cut = t.slice(0, SEO_TITLE_MAX_LEN);
  const lastSpace = cut.lastIndexOf(' ');
  if (lastSpace > SEO_TITLE_MAX_LEN * 0.6) return cut.slice(0, lastSpace);
  return cut;
}

export function isPureKoreanSeoTitle(s: string): boolean {
  const t = s.trim();
  if (!t) return false;
  return /^[가-힣0-9\s]+$/.test(t);
}
