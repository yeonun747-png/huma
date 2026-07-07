import type { NarrationAxisType, NarrationFormatType, NarrationPeriodType } from '@huma/shared';
import { periodTitleKeyword, type NarrationDateContext } from './date-context.js';

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

export function buildAxisTitlePrefix(axisType: NarrationAxisType): string {
  if (axisType === 'zodiac') return '띠별로 알아보는';
  if (axisType === 'constellation') return '별자리로 알아보는';
  return '연령대별로 알아보는';
}

export function buildFallbackNarrationTitle(
  topicLabel: string,
  axisType: NarrationAxisType,
  formatType: NarrationFormatType,
  periodType: NarrationPeriodType = 'daily',
): string {
  const prefix = buildAxisTitlePrefix(axisType);
  const period = periodTitleKeyword(periodType);
  const topic = topicLabel.trim() || '운세';
  if (formatType === 'ranked') {
    return `${period} ${prefix} ${topic} TOP5`;
  }
  return `${period} ${prefix} ${topic}`;
}

const WEAK_TITLE_PATTERNS = [
  /^.{0,8}(한눈에|살펴보|알아보세요|확인해)\s*$/,
  /^.{0,12}(흐름|정리|가이드)$/,
];

export function validateNarrationTitle(
  title: string,
  axisType: NarrationAxisType,
  periodType: NarrationPeriodType = 'daily',
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
  if (!t.includes(periodWord) && !t.includes(periodAlt)) {
    return {
      ok: false,
      message: `제목에 주기 표현 "${periodWord}"(또는 "${periodAlt}")이 포함되어야 합니다`,
    };
  }

  const axisWord = axisTitleKeyword(axisType);
  if (!t.includes(axisWord)) {
    const prefix = buildAxisTitlePrefix(axisType);
    return {
      ok: false,
      message: `제목에 "${axisWord}" 축이 드러나야 합니다 (예: "${prefix} ○○")`,
    };
  }

  const hasAxisPrefix = /(띠별|별자리|연령대).{0,4}알아보는/.test(t);
  const hasHook =
    /[?？]/.test(t) ||
    /\d/.test(t) ||
    /TOP|top|1위|당신|나는|우리|비밀|충격|역대|이유|진짜|놀라|의외|주의|경고|기회/.test(t);
  if (!hasAxisPrefix && !hasHook && WEAK_TITLE_PATTERNS.some((re) => re.test(t))) {
    return {
      ok: false,
      message: '제목이 설명형 부제 수준입니다 — 질문·숫자·반전·"당신은?" 등 후킹 요소 추가',
    };
  }
  if (!hasAxisPrefix && !hasHook) {
    return {
      ok: false,
      message:
        '제목 후킹이 약합니다 — "띠별/별자리/연령대별로 알아보는 ○○" + 궁금증(?, 1위, 당신은?) 조합',
    };
  }

  return { ok: true };
}

export function buildTitlePromptBlock(
  axisType: NarrationAxisType,
  topicLabel: string,
  periodType: NarrationPeriodType,
  dateContext: NarrationDateContext,
): string {
  const prefix = buildAxisTitlePrefix(axisType);
  const axisWord = axisTitleKeyword(axisType);
  const periodLabel = periodTitleKeyword(periodType);
  const examples =
    axisType === 'zodiac'
      ? [
          `${periodLabel} ${prefix} ${topicLabel}, 12띠 중 당신은?`,
          `${periodLabel} 운 좋은 띠 1위는? ${topicLabel}`,
        ]
      : axisType === 'constellation'
        ? [
            `${periodLabel} ${prefix} ${topicLabel}`,
            `${periodLabel} 재회 가능성 높은 별자리 1위는?`,
          ]
        : [
            `${periodLabel} ${prefix} ${topicLabel}, 내 나이대는?`,
            `${periodLabel} 40대만 해당? 연령대별 ${topicLabel}`,
          ];

  return `${dateContext.promptBlock}

제목 (가장 중요 — 클릭·시청을 결정):
- 반드시 "${periodLabel}"(또는 "${periodTitleKeyword(periodType).replace(/\s/g, '')}") + "${prefix}" 또는 "${axisWord}" 축
- 상품 주제「${topicLabel}」를 자연스럽게 포함
- 시점: ${dateContext.absoluteLabel} 맥락이 제목·오프닝에서 바로 보이게
- 설명형 부제만 쓰지 말 것 (예: "한눈에", "살펴보세요" 단독 금지)
- 질문·숫자·1위·당신은·반전·궁금증 중 1개 이상
- 14~44자, 숏폼 썸네일·첫 화면용 한 줄
- 좋은 예: ${examples.map((e) => `"${e}"`).join(' / ')}`;
}
