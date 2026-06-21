/** 영상 페르소나 텍스트 — ## 섹션 불릿만 추출 (설명 문단 무시) */

const SECTION_HEADER_RE = /^##\s+(.+?)\s*$/;

/** `- 항목`, `* 항목`, `• 항목` 형식만 인정 */
const BULLET_LINE_RE = /^[-*•]\s+(.+?)\s*$/;

function normalizeOptionLabel(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

/** ## header 섹션 본문 (다음 ## 전까지) */
export function extractSectionBody(personaText: string, sectionHeader: string): string {
  const lines = personaText.replace(/\r\n/g, '\n').split('\n');
  const target = sectionHeader.trim();
  let inSection = false;
  const body: string[] = [];

  for (const line of lines) {
    const headerMatch = line.match(SECTION_HEADER_RE);
    if (headerMatch) {
      const header = headerMatch[1]!.trim();
      if (header === target) {
        inSection = true;
        continue;
      }
      if (inSection) break;
      continue;
    }
    if (inSection) body.push(line);
  }

  return body.join('\n').trim();
}

/** ## 섹션 아래 불릿 목록만 추출 */
export function extractAxisOptions(personaText: string, sectionHeader: string): string[] {
  const body = extractSectionBody(personaText, sectionHeader);
  if (!body) return [];

  const options: string[] = [];
  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const bullet = trimmed.match(BULLET_LINE_RE);
    if (!bullet) continue;
    const label = normalizeOptionLabel(bullet[1]!);
    if (label.length >= 1 && label.length <= 48) options.push(label);
  }
  return options;
}

/** ## 펀치라인 메커니즘 — `A. 반전 — …` 형식에서 메커니즘 라벨 추출 */
export function extractHookMechanisms(personaText: string): string[] {
  const body = extractSectionBody(personaText, '펀치라인 메커니즘');
  if (!body) return [];

  const options: string[] = [];
  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    const match = trimmed.match(/^[A-D]\.\s*([^—–\-]+)/);
    if (!match) continue;
    const label = normalizeOptionLabel(match[1]!);
    if (label.length >= 1 && label.length <= 24) options.push(label);
  }
  return options;
}

export function extractHookSubtypes(personaText: string): string[] {
  return extractAxisOptions(personaText, 'hook_subtype');
}

export function validatePersonaTextHeaders(
  personaText: string,
  requiredHeaders: string[],
): { ok: true } | { ok: false; missing: string[] } {
  const missing = requiredHeaders.filter((h) => !extractSectionBody(personaText, h));
  if (missing.length) return { ok: false, missing };
  return { ok: true };
}

export const PERSONA_REQUIRED_HEADERS: Record<'yeonun' | 'quizoasis' | 'panana', string[]> = {
  yeonun: ['관계축', '감정곡선', '펀치라인 메커니즘', 'hook_subtype', '컷 구성', '샷 구조', '서비스 제약'],
  quizoasis: ['관계축', '감정곡선', '펀치라인 메커니즘', 'hook_subtype', '컷 구성', '샷 구조', '서비스 제약'],
  panana: ['관계축', '상황축', '감정곡선', '펀치라인 메커니즘', 'hook_subtype', '컷 구성', '샷 구조', '서비스 제약'],
};
