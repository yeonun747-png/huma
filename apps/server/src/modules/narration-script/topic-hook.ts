/** 카탈로그 상품명 → 숏폼 제목·CTA용 짧은 훅 (2~8자) */
export function deriveNarrationHookLabel(catalogTitle: string): string {
  const raw = catalogTitle.trim();
  if (!raw) return '운세';

  const full = raw.replace(/\s+/g, ' ');
  const firstSegment = full.split(/[·|｜—–\-/]/)[0]?.trim() ?? full;

  const KEYWORD_RULES: Array<{ pattern: RegExp; hook: string }> = [
    { pattern: /작명|이름\s*짓/i, hook: '작명' },
    { pattern: /신년|연간\s*운|일년\s*운/i, hook: '신년운세' },
    { pattern: /재회|다시\s*만/i, hook: '재회운' },
    { pattern: /재물|금전|돈/i, hook: '재물운' },
    { pattern: /연애|애정|썸/i, hook: '연애운' },
    { pattern: /결혼|배우자|배필/i, hook: '결혼운' },
    { pattern: /건강|질병|회복/i, hook: '건강운' },
    { pattern: /직장|승진|이직|취업/i, hook: '직장운' },
    { pattern: /사업|창업|매출/i, hook: '사업운' },
    { pattern: /궁합|커플/i, hook: '궁합' },
    { pattern: /타로/i, hook: '타로' },
    { pattern: /자미두수|14주성/i, hook: '자미두수' },
    { pattern: /대운|평생/i, hook: '대운' },
    { pattern: /토정/i, hook: '토정비결' },
  ];

  for (const rule of KEYWORD_RULES) {
    if (rule.pattern.test(full)) return rule.hook;
  }

  let hook = firstSegment
    .replace(/^\d{4}\s*년?\s*/, '')
    .replace(/^\d{4}\s*/, '')
    .replace(/\s*일년\s*/g, ' ')
    .replace(/^아이\s*이름\s*/i, '')
    .replace(/\s*(풀이|상담|리포트|분석|가이드)\s*$/i, '')
    .trim();

  const tailMatch = hook.match(/(신년운세|토정비결|자미두수|운세|궁합|타로|작명|대운|[가-힣]{2,4}운)$/);
  if (tailMatch) return tailMatch[1]!;

  if (hook.length > 8) {
    hook = hook.replace(/^(그\s*사람과|내\s*평생의|올\s*한\s*해)\s*/i, '').trim();
  }
  if (hook.length > 8) hook = hook.slice(0, 8).trim();

  return hook || '운세';
}

export function titleIncludesHook(title: string, hookLabel: string): boolean {
  const hook = hookLabel.trim();
  if (!hook || hook === '운세') return true;
  if (title.includes(hook)) return true;
  if (hook.length >= 3) {
    const stem = hook.replace(/운세$|운$/, '');
    if (stem.length >= 2 && title.includes(stem)) return true;
  }
  return false;
}

export function titleContainsCatalogName(title: string, catalogTitle: string): boolean {
  const catalog = catalogTitle.trim();
  if (catalog.length < 10) return false;
  if (title.includes(catalog)) return true;
  const firstSegment = catalog.split(/[·|｜—–\-/]/)[0]?.trim() ?? '';
  if (firstSegment.length >= 8 && title.includes(firstSegment)) return true;
  const chunk = catalog.slice(0, Math.min(16, catalog.length)).trim();
  return chunk.length >= 8 && title.includes(chunk);
}

/** CTA 앞부분 — 상품 전체명 대신 훅 라벨 */
export function buildNarrationCtaLead(hookLabel: string): string {
  const hook = hookLabel.trim() || '운세';
  if (/작명/.test(hook)) return '더 정확한 작명 풀이가 궁금하다면';
  if (/신년|연간/.test(hook)) {
    const label = hook.includes('운') ? hook : '신년운세';
    return `올해 ${label} 전체가 궁금하다면`;
  }
  if (/운$/.test(hook) && !/운세$/.test(hook)) return `더 정확한 ${hook}이 궁금하다면`;
  if (/운세$/.test(hook)) return `더 정확한 ${hook}가 궁금하다면`;
  if (/궁합|타로|자미두수|토정|대운/.test(hook)) return `더 정확한 ${hook} 풀이가 궁금하다면`;
  return `더 정확한 ${hook} 풀이가 궁금하다면`;
}

export function buildPeriodAngleBlock(
  periodType: 'daily' | 'weekly' | 'monthly',
  hookLabel: string,
  catalogTitle: string,
  absoluteLabel: string,
): string {
  const catalogNote =
    catalogTitle.trim() && catalogTitle.trim() !== hookLabel
      ? `- 상품 전체명「${catalogTitle.trim()}」은 **제목·오프닝에 그대로 넣지 말 것** — 숏폼 훅「${hookLabel}」만`
      : `- 숏폼 훅 키워드: 「${hookLabel}」`;

  if (periodType === 'daily') {
    return `[이번 영상 각도 — 데일리]
- **오늘 하루** / 오늘의 ${hookLabel} 관점만 (${absoluteLabel} 맥락)
${catalogNote}
- 본문·오프닝에서 상품 풀 풀이는 CTA로 유도 — 지금 영상은 오늘 슬라이스`;
  }
  if (periodType === 'weekly') {
    return `[이번 영상 각도 — 주간]
- **이번 주**(${absoluteLabel}) 구간만 — 연간·월간 상품도 이번 주 흐름만 짚을 것
${catalogNote}
- 제목·오프닝: 주기(이번 주) > 훅(${hookLabel}) > 축/순위`;
  }
  return `[이번 영상 각도 — 월간]
- **이번 달** / 이달의 ${hookLabel} 관점 (${absoluteLabel} 맥락)
${catalogNote}
- 제목·오프닝: 주기(이달·이번 달) > 훅(${hookLabel}) > 축/순위`;
}
