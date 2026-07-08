import type { NarrationAxisType, NarrationFormatType, NarrationPeriodType } from '@huma/shared';
import { resolveNarrationRankedTopN } from '@huma/shared';
import { periodTitleKeyword, type NarrationDateContext } from './date-context.js';
import {
  buildPeriodAngleBlock,
  titleContainsCatalogName,
  titleIncludesHook,
} from './topic-hook.js';

/** LLM이 문장마다 넣는 불필요한 빈 줄 제거 — 항목 구분은 단일 줄바꿈만 */
export function normalizeNarrationBody(body: string): string {
  return body
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

export function axisTitleKeyword(axisType: NarrationAxisType): string {
  if (axisType === 'zodiac') return '띠';
  if (axisType === 'constellation') return '별자리';
  return '연령';
}

export function buildFallbackNarrationTitle(
  hookLabel: string,
  axisType: NarrationAxisType,
  formatType: NarrationFormatType,
  periodType: NarrationPeriodType = 'daily',
): string {
  const axisWord = axisTitleKeyword(axisType);
  const period = periodTitleKeyword(periodType);
  const hook = hookLabel.trim() || '운세';
  const rankedN = resolveNarrationRankedTopN(periodType, axisType);

  if (formatType === 'ranked') {
    return `${period} ${hook} ${axisWord} TOP${rankedN}, 1위는?`;
  }
  return `${period} ${axisWord} ${hook}, 당신은?`;
}

const WEAK_TITLE_PATTERNS = [
  /^.{0,8}(한눈에|살펴보|알아보세요|확인해)\s*$/,
  /^.{0,12}(흐름|정리|가이드)$/,
];

export function validateNarrationTitle(
  title: string,
  axisType: NarrationAxisType,
  periodType: NarrationPeriodType = 'daily',
  hookLabel = '운세',
  catalogTitle?: string,
): { ok: true } | { ok: false; message: string } {
  const t = title.trim();
  if (t.length < 8) {
    return { ok: false, message: '제목이 너무 짧습니다 — 후킹 문구를 더 길게' };
  }
  if (t.length > 48) {
    return { ok: false, message: '제목이 너무 깁니다 — 48자 이내 숏폼 후킹' };
  }

  const periodWord = periodTitleKeyword(periodType);
  const periodAlt = periodWord.replace(/\s/g, '');
  const periodOk =
    periodType === 'monthly'
      ? /이달|이번\s*달/.test(t)
      : t.includes(periodWord) || t.includes(periodAlt);
  if (!periodOk) {
    return {
      ok: false,
      message:
        periodType === 'monthly'
          ? '제목에 "이달" 또는 "이번 달" 표현이 포함되어야 합니다'
          : `제목에 주기 표현 "${periodWord}"(또는 "${periodAlt}")이 포함되어야 합니다`,
    };
  }

  const axisWord = axisTitleKeyword(axisType);
  const axisOk =
    t.includes(axisWord) ||
    (axisType === 'generation' && /연령대|나이대|대생/.test(t)) ||
    (axisType === 'zodiac' && /띠/.test(t));
  if (!axisOk) {
    return {
      ok: false,
      message: `제목에 "${axisWord}" 축이 드러나야 합니다 (예: "${hookLabel} ${axisWord}")`,
    };
  }

  if (!titleIncludesHook(t, hookLabel)) {
    return {
      ok: false,
      message: `제목에 숏폼 훅「${hookLabel}」가 포함되어야 합니다 — 상품 전체명 대신 짧은 키워드`,
    };
  }

  if (catalogTitle && titleContainsCatalogName(t, catalogTitle)) {
    return {
      ok: false,
      message: '제목에 상품 전체명이 들어갔습니다 — 숏폼 훅 키워드만 사용',
    };
  }

  const hasHook =
    /[?？]/.test(t) ||
    /\d/.test(t) ||
    /TOP|top|1위|당신|나는|우리|비밀|충격|역대|이유|진짜|놀라|의외|주의|경고|기회|핵심|해당/.test(t);
  if (!hasHook && WEAK_TITLE_PATTERNS.some((re) => re.test(t))) {
    return {
      ok: false,
      message: '제목이 설명형 부제 수준입니다 — 질문·숫자·1위·당신은? 등 후킹 요소 추가',
    };
  }
  if (!hasHook) {
    return {
      ok: false,
      message: `제목 후킹이 약합니다 — "${periodWord} + ${hookLabel} + ${axisWord}" + 궁금증(?, 1위, 당신은?)`,
    };
  }

  return { ok: true };
}

function buildTitleExamples(
  axisType: NarrationAxisType,
  hookLabel: string,
  periodType: NarrationPeriodType,
  formatType: NarrationFormatType,
): string[] {
  const axisWord = axisTitleKeyword(axisType);
  const periodLabel = periodTitleKeyword(periodType);
  const hook = hookLabel.trim() || '운세';

  if (formatType === 'ranked') {
    if (axisType === 'zodiac') {
      return [
        `${periodLabel} ${hook} ${axisWord} TOP5, 1위는?`,
        `${periodLabel} 운 좋은 ${axisWord} TOP5, ${hook}`,
      ];
    }
    if (axisType === 'constellation') {
      return [
        `${periodLabel} ${axisWord} ${hook} TOP5, 1위는?`,
        `${periodLabel} ${hook} ${axisWord}, 당신은?`,
      ];
    }
    return [
      `${periodLabel} ${hook} ${axisWord} TOP5, 내 나이대는?`,
      `${periodLabel} ${axisWord} ${hook}, 40대만 해당?`,
    ];
  }

  if (periodType === 'monthly') {
    return [
      `이번 달 ${axisWord} ${hook}, 당신은?`,
      `이달 ${hook} ${axisWord}, 이번 달 핵심은?`,
    ];
  }
  if (periodType === 'weekly') {
    return [
      `이번 주 ${axisWord} ${hook}, 이번 주 핵심은?`,
      `이번 주 ${hook} ${axisWord}, 당신만 해당?`,
    ];
  }

  return [
    `오늘 ${axisWord} ${hook}, 당신은?`,
    `오늘 ${hook} ${axisWord}, 오늘 핵심은?`,
  ];
}

export function buildTitlePromptBlock(
  axisType: NarrationAxisType,
  hookLabel: string,
  catalogTitle: string,
  periodType: NarrationPeriodType,
  dateContext: NarrationDateContext,
  formatType: NarrationFormatType = 'full_cover',
): string {
  const axisWord = axisTitleKeyword(axisType);
  const periodLabel = periodTitleKeyword(periodType);
  const hook = hookLabel.trim() || '운세';
  const examples = buildTitleExamples(axisType, hook, periodType, formatType);

  const angleBlock = buildPeriodAngleBlock(
    periodType,
    hook,
    catalogTitle,
    dateContext.absoluteLabel,
  );

  return `${dateContext.promptBlock}

${angleBlock}

제목 (가장 중요 — 클릭·시청을 결정):
- 반드시 "${periodLabel}" + 숏폼 훅「${hook}」+ "${axisWord}" 축 (띠/별자리/연령)
- **상품 전체명「${catalogTitle}」은 제목에 넣지 말 것** — 훅「${hook}」만
- 시점: ${dateContext.absoluteLabel} 맥락이 제목·오프닝에서 바로 보이게
- "띠별로 알아보는 ○○" 같은 긴 접두어 **금지** — 짧고 후킹되게
- 설명형 부제만 쓰지 말 것 (예: "한눈에", "살펴보세요" 단독 금지)
- 질문·숫자·1위·TOP·당신은·반전·궁금증 중 1개 이상
- 14~44자, 숏폼 썸네일·첫 화면용 한 줄
- 좋은 예: ${examples.map((e) => `"${e}"`).join(' / ')}`;
}
