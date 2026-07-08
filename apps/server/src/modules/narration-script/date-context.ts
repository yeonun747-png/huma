import type { NarrationAxisType, NarrationPeriodType } from '@huma/shared';
import { resolveNarrationTopN } from '@huma/shared';

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export interface NarrationDateContext {
  periodType: NarrationPeriodType;
  absoluteLabel: string;
  periodPhrase: string;
  promptBlock: string;
}

function toKstParts(ref: Date): { y: number; m: number; d: number; day: number } {
  const kst = new Date(ref.getTime() + KST_OFFSET_MS);
  return {
    y: kst.getUTCFullYear(),
    m: kst.getUTCMonth() + 1,
    d: kst.getUTCDate(),
    day: kst.getUTCDay(),
  };
}

/** KST 기준 당월 [start, end) ISO — DB 조회용 */
export function kstMonthBoundaries(refDate: Date = new Date()): {
  year: number;
  month: number;
  startIso: string;
  endIso: string;
} {
  const { y, m } = toKstParts(refDate);
  const startMs = Date.UTC(y, m - 1, 1) - KST_OFFSET_MS;
  const nextY = m === 12 ? y + 1 : y;
  const nextM = m === 12 ? 1 : m + 1;
  const endMs = Date.UTC(nextY, nextM - 1, 1) - KST_OFFSET_MS;
  return {
    year: y,
    month: m,
    startIso: new Date(startMs).toISOString(),
    endIso: new Date(endMs).toISOString(),
  };
}

function weekOfMonth(day: number): number {
  return Math.min(5, Math.ceil(day / 7));
}

const WEEKDAY_KO = ['일', '월', '화', '수', '목', '금', '토'];
const WEEK_ORDINAL = ['첫', '둘', '셋', '넷', '다섯'];

export function buildNarrationDateContext(
  periodType: NarrationPeriodType,
  refDate: Date = new Date(),
  axisType?: NarrationAxisType,
): NarrationDateContext {
  const { y, m, d, day } = toKstParts(refDate);
  const ym = `${y}년 ${m}월`;

  if (periodType === 'daily') {
    const absoluteLabel = `${y}년 ${m}월 ${d}일`;
    const promptBlock = `[시점 — 데일리]
- 제목·오프닝 첫 문장에 반드시 "${absoluteLabel}" 또는 "${y}년 ${m}월 ${d}일(${WEEKDAY_KO[day]})" 포함
- 본문 시기: "오늘", "오늘 하루", "지금" 등 **상대 표현만**
- "9월 초", "10월 중순" 같이 월+순서만 있는 **절대 월 표현 금지**`;
    return { periodType, absoluteLabel, periodPhrase: '오늘', promptBlock };
  }

  if (periodType === 'weekly') {
    const weekN = weekOfMonth(d);
    const absoluteLabel = `${ym} ${WEEK_ORDINAL[weekN - 1] ?? weekN}째 주`;
    const promptBlock = `[시점 — 주간]
- 제목·오프닝 첫 문장에 "이번 주"와 "${absoluteLabel}" 또는 "${ym}" 포함
- 본문 시기: "이번 주", "이번 주 중반", "주 중반" 등 **상대 표현만**
- "9월 초", "다음 달" 등 **절대 월·일 표현 금지**`;
    return { periodType, absoluteLabel, periodPhrase: '이번 주', promptBlock };
  }

  const absoluteLabel = ym;
  const topN = axisType ? resolveNarrationTopN(axisType) : 12;
  const promptBlock = `[시점 — 월간 · 이달 TOP${topN} 시리즈]
- 포맷: **이달 TOP${topN} 순위특집 시리즈** (전체커버형 아님 — ${topN}위→1위)
- 제목·오프닝 첫 문장에 "이달"(또는 "이번 달")과 "${absoluteLabel}" 포함
- 제목에 반드시 "TOP${topN}" + "시리즈" + "N편" + 숏폼 훅 표기 (예: 이달 작명 띠 TOP${topN} 시리즈 2편)
- 본문 시기: "이번 달", "이달 중순", "월 초반" 등 **상대 표현만**
- "9월", "10월 중순" 같이 **다른 달·절대 월 표현 금지**`;
  return { periodType, absoluteLabel, periodPhrase: '이번 달', promptBlock };
}

export function hasAmbiguousAbsoluteMonthPhrase(body: string): boolean {
  return /(?<![0-9년])(?:1[0-2]|[1-9])월\s*(?:초|중순|중반|말|상순|하순|초반|후반)/.test(body);
}

export function periodTitleKeyword(periodType: NarrationPeriodType): string {
  if (periodType === 'daily') return '오늘';
  if (periodType === 'weekly') return '이번 주';
  return '이번 달';
}
