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
    body: stripLlmFooterLines(normalizeNarrationBody(draft.body)),
  };
}

/** LLM이 CTA·면피를 넣은 경우 시스템 append 전 제거 */
function stripLlmFooterLines(body: string): string {
  const lines = body.split('\n');
  const kept: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    if (/같은\s*띠여도/.test(t)) continue;
    if (/연운\s*\(\s*yeonun\.com\s*\)/i.test(t)) continue;
    if (/포춘82\s*\(\s*fortune82\.com\s*\)/i.test(t)) continue;
    if (/가입하면\s*5\s*천\s*원\s*크레딧/.test(t)) continue;
    if (/더\s*(정확한|자세한)\s*내/.test(t) && /(yeonun|fortune82)\.com/i.test(t)) continue;
    if (/결제하시면\s*코드와\s*인증번호/.test(t)) continue;
    if (/화면을\s*두\s*번?\s*터치|화면을\s*두번터치/i.test(t)) continue;
    kept.push(line);
  }
  return kept.join('\n').trim();
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

function axisMismatchRule(axisType: NarrationAxisType): string {
  if (axisType === 'constellation') {
    return '- 주제가 별·자미두수·14주성·별자리 관련 — **양자리~물고기자리 12개만**. 쥐띠~돼지띠 **절대 금지**';
  }
  if (axisType === 'zodiac') {
    return '- **쥐띠~돼지띠 12개만**. 양자리~물고기자리 **절대 금지**';
  }
  return '- **60~00년대생 5개 연령대만**';
}

export function buildFullCoverPrompt(params: PromptBase): string {
  const labels = axisInstances(params.axisType);
  const axisName =
    params.axisType === 'zodiac' ? '띠' : params.axisType === 'constellation' ? '별자리' : '연령대';
  const mismatchRule = axisMismatchRule(params.axisType);
  const instanceLines = labels.map((i) => `- ${i.label}`).join('\n');
  const titleBlock = buildTitlePromptBlock(
    params.axisType,
    params.topicLabel,
    params.periodType,
    params.dateContext,
  );
  const { min, max } = fullCoverLengthBounds(params.axisType);

  return `아래 [이번 작업] 지시에 따라 대본 JSON만 작성하라. system 역할·금지 규칙을 반드시 준수.

한국어 숏폼 나레이션 대본(전체커버형·${params.periodType}) — 브루(Vrew) TTS용.

서비스: ${params.workspaceLabel}
주제(상품): ${params.topicLabel}
축: ${axisName} — 아래 ${labels.length}개 **전부** 다룰 것.

${params.topicContext}

포함할 ${axisName} (${labels.length}개 전부):
${instanceLines}

${titleBlock}

규칙:
- JSON: {"title":"...","body":"..."} 만 출력
- ${mismatchRule}
- 오프닝 1~2문장: 시청자가 5초 안에 "지금 내 얘기"라고 느끼게 (날짜·주기·축·주제 제목 소개)
- **"화면을 두번터치"·댓글 유도 금지** (시스템이 오프닝 직후 삽입)
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
  const mismatchRule = axisMismatchRule(params.axisType);
  const pool = labels.map((i) => i.label).join(', ');
  const titleBlock = buildTitlePromptBlock(
    params.axisType,
    params.topicLabel,
    params.periodType,
    params.dateContext,
  );
  const { min, max } = rankedLengthBounds();

  return `아래 [이번 작업] 지시에 따라 대본 JSON만 작성하라. system 역할·금지 규칙을 반드시 준수.

한국어 숏폼 나레이션 대본(순위특집형 TOP5·${params.periodType}) — 브루(Vrew) TTS용.

서비스: ${params.workspaceLabel}
주제(상품): ${params.topicLabel}
축: ${axisName}

${params.topicContext}

후보 풀: ${pool}

${titleBlock}

규칙:
- ${mismatchRule}
- 제목: 주기 + TOP5 + 축 + 후킹
- 오프닝 **강한 후킹** + 시점(${params.dateContext.absoluteLabel}) + 주제 제목 소개
- **"화면을 두번터치"·댓글 유도 금지** (시스템이 오프닝 직후 삽입)
- 5위→1위 순, 각 3~4문장
- 1위는 "그리고 1위는..." 서스펜스 후 공개
- ${axisName} 5개만 선택
- **본문 빈 줄 금지**
- 전체 1분30초 이상 (${min}~${max}자)
- CTA·면피 **금지**
- JSON만: {"title":"...","body":"..."}`;
}
