/** Claude 프롬프트·캐시 컨텍스트 — blog_post에 그대로 노출되면 안 되는 내부 마커 */
const INTERNAL_LINE_PATTERNS: RegExp[] = [
  /^\[참조 URL[^\]]*\]/i,
  /^\[URL fetch[^\]]*\]/i,
  /^\[URL 페이지 요약\]/i,
  /^\[캐시 컨텍스트 적용[^\]]*\]/i,
  /^\[퀴즈오아시스 테스트\]/i,
  /^\[파나나 캐릭터\]/i,
  /^\[연운 상품 정보\]/i,
  /^slug:\s*\S+/i,
  /^\(블로그 글은 이 테스트[^\)]*\)/i,
  /^\(이번 영상에 자연스럽게[^\)]*\)/i,
  /^\[시놉시스 없음[^\]]*\]/i,
  /^\[참조 URL 없음[^\]]*\]/i,
];

export function stripInternalPostingMarkers(text: string): string {
  const lines = text.split('\n');
  const kept: string[] = [];
  let skipBlock = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (!skipBlock && kept.length > 0 && kept[kept.length - 1] !== '') kept.push('');
      continue;
    }

    if (INTERNAL_LINE_PATTERNS.some((re) => re.test(trimmed))) {
      skipBlock = true;
      continue;
    }

    if (/^제목:\s/.test(trimmed) && skipBlock) continue;
    if (/^소개:\s/.test(trimmed) && skipBlock) continue;

    skipBlock = false;
    kept.push(line);
  }

  return kept
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function workspaceSeoTitleExtraGuide(workspace: string): string {
  if (workspace === 'quizoasis') {
    return '- SEO 제목에 「퀴즈오아시스」(또는 공간 부족 시 「퀴즈오아」)를 자연스럽게 1회 포함. 예: "사랑의 언어 테스트 퀴즈오아시스", "퀴즈오아시스 연애유형 진단"';
  }
  return '';
}
