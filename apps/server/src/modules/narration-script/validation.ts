import type { NarrationAxisType, NarrationFormatType, NarrationPeriodType } from '@huma/shared';
import { axisInstanceLabels, axisInstances } from './axis-instances.js';
import type { NarrationDateContext } from './date-context.js';
import { hasAmbiguousAbsoluteMonthPhrase } from './date-context.js';
import {
  buildTitlePromptBlock,
  normalizeNarrationBody,
  validateNarrationTitle,
} from './format.js';

export interface GeneratedNarrationDraft {
  title: string;
  body: string;
}

export function sanitizeNarrationDraft(draft: GeneratedNarrationDraft): GeneratedNarrationDraft {
  return {
    title: draft.title.trim(),
    body: normalizeNarrationBody(draft.body),
  };
}

function fullCoverLengthBounds(axisType: NarrationAxisType): { min: number; max: number } {
  if (axisType === 'generation') return { min: 280, max: 720 };
  return { min: 250, max: 650 };
}

function rankedLengthBounds(): { min: number; max: number } {
  return { min: 420, max: 850 };
}

export function validateNarrationDraft(
  draft: GeneratedNarrationDraft,
  formatType: NarrationFormatType,
  axisType: NarrationAxisType,
  periodType: NarrationPeriodType = 'daily',
): { ok: true } | { ok: false; message: string } {
  const title = draft.title.trim();
  const body = draft.body.trim();
  if (!title) return { ok: false, message: '제목이 비어 있습니다' };

  const titleCheck = validateNarrationTitle(title, axisType, periodType);
  if (!titleCheck.ok) return titleCheck;

  if (/\n{2,}/.test(body)) {
    return { ok: false, message: '본문에 빈 줄이 있습니다 — 문장·항목 사이 빈 줄 없이 단일 줄바꿈만' };
  }

  if (hasAmbiguousAbsoluteMonthPhrase(body)) {
    return {
      ok: false,
      message: '본문에 "9월 초" 같은 절대 월 표현이 있습니다 — 오늘/이번 주/이번 달 등 상대 표현만',
    };
  }

  const lengthBounds =
    formatType === 'full_cover' ? fullCoverLengthBounds(axisType) : rankedLengthBounds();
  if (body.length < lengthBounds.min) {
    return { ok: false, message: `대본이 너무 짧습니다 (최소 ${lengthBounds.min}자)` };
  }
  if (body.length > lengthBounds.max) {
    return { ok: false, message: `대본이 너무 깁니다 (최대 ${lengthBounds.max}자)` };
  }

  const labels = axisInstanceLabels(axisType);

  if (formatType === 'full_cover') {
    const missing = labels.filter((label) => !body.includes(label));
    if (missing.length > 0) {
      return {
        ok: false,
        message: `전체커버형 — 다음 인스턴스가 대본에 없습니다: ${missing.slice(0, 4).join(', ')}`,
      };
    }
    return { ok: true };
  }

  const rankMatches = body.match(/[1-5]\s*위/g) ?? [];
  if (rankMatches.length < 5) {
    return { ok: false, message: '순위특집형 — 5위~1위 표기가 부족합니다' };
  }

  const mentioned = labels.filter((label) => body.includes(label));
  if (mentioned.length < 5) {
    return { ok: false, message: '순위특집형 — 별자리/띠/연령대 5개가 모두 포함되지 않았습니다' };
  }

  if (!/1\s*위/.test(body) && !/1위/.test(body)) {
    return { ok: false, message: '순위특집형 — 1위 구간이 없습니다' };
  }

  return { ok: true };
}

type PromptBase = {
  topicLabel: string;
  topicContext: string;
  axisType: NarrationAxisType;
  workspaceLabel: string;
  periodType: NarrationPeriodType;
  dateContext: NarrationDateContext;
};

function instanceSentenceRule(axisType: NarrationAxisType): string {
  if (axisType === 'generation') {
    return '각 연령대 4~5문장 — 자연스러운 호흡, 억지로 늘리지 말 것';
  }
  return '각 띠/별자리 2~3문장 — 자연스러운 호흡, 억지로 늘리지 말 것';
}

export function buildFullCoverPrompt(params: PromptBase): string {
  const labels = axisInstances(params.axisType);
  const axisName =
    params.axisType === 'zodiac' ? '띠' : params.axisType === 'constellation' ? '별자리' : '연령대';
  const instanceLines = labels.map((i) => `- ${i.label}`).join('\n');
  const titleBlock = buildTitlePromptBlock(
    params.axisType,
    params.topicLabel,
    params.periodType,
    params.dateContext,
  );
  const { min, max } = fullCoverLengthBounds(params.axisType);

  return `한국어 숏폼 나레이션 대본(전체커버형·${params.periodType})을 작성하라. 브루(Vrew) TTS용.

서비스: ${params.workspaceLabel}
주제(상품): ${params.topicLabel}
축: ${axisName} — 아래 ${labels.length}개 **전부** 다룰 것.

${params.topicContext}

포함할 ${axisName} (${labels.length}개 전부):
${instanceLines}

${titleBlock}

규칙:
- JSON: {"title":"...","body":"..."} 만 출력
- 오프닝 1~2문장: 시청자가 5초 안에 "지금 내 얘기"라고 느끼게 (날짜·주기·축)
- 본문: 각 인스턴스를 "쥐띠:" 또는 "양자리:" 형식
- ${instanceSentenceRule(params.axisType)}
- 전체 1분~1분30초 (${min}~${max}자)
- **본문 빈 줄 금지**
- 숫자는 아라비아 숫자 그대로
- CTA·면피 **금지** (시스템 append)
- 따옴표로 전체를 감싸지 말 것`;
}

export function buildRankedPrompt(params: PromptBase): string {
  const labels = axisInstances(params.axisType);
  const axisName =
    params.axisType === 'zodiac' ? '띠' : params.axisType === 'constellation' ? '별자리' : '연령대';
  const pool = labels.map((i) => i.label).join(', ');
  const titleBlock = buildTitlePromptBlock(
    params.axisType,
    params.topicLabel,
    params.periodType,
    params.dateContext,
  );
  const { min, max } = rankedLengthBounds();

  return `한국어 숏폼 나레이션 대본(순위특집형 TOP5·${params.periodType})을 작성하라. 브루 TTS용.

서비스: ${params.workspaceLabel}
주제(상품): ${params.topicLabel}
축: ${axisName}

${params.topicContext}

후보 풀: ${pool}

${titleBlock}

규칙:
- 제목: 주기 + TOP5 + 축 + 후킹
- 오프닝 **강한 후킹** + 시점(${params.dateContext.absoluteLabel})
- 5위→1위 순, 각 3~4문장
- 1위는 "그리고 1위는..." 서스펜스 후 공개
- ${axisName} 5개만 선택
- **본문 빈 줄 금지**
- 전체 1분30초 이상 (${min}~${max}자)
- CTA·면피 **금지**
- JSON만: {"title":"...","body":"..."}`;
}
