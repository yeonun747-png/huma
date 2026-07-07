import type { NarrationAxisType, NarrationFormatType } from '@huma/shared';
import { axisInstanceLabels, axisInstances } from './axis-instances.js';
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

export function validateNarrationDraft(
  draft: GeneratedNarrationDraft,
  formatType: NarrationFormatType,
  axisType: NarrationAxisType,
): { ok: true } | { ok: false; message: string } {
  const title = draft.title.trim();
  const body = draft.body.trim();
  if (!title) return { ok: false, message: '제목이 비어 있습니다' };
  if (body.length < 120) return { ok: false, message: '대본이 너무 짧습니다' };

  const titleCheck = validateNarrationTitle(title, axisType);
  if (!titleCheck.ok) return titleCheck;

  if (/\n{2,}/.test(body)) {
    return { ok: false, message: '본문에 빈 줄이 있습니다 — 문장·항목 사이 빈 줄 없이 단일 줄바꿈만' };
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

export function buildFullCoverPrompt(params: {
  topicLabel: string;
  topicContext: string;
  axisType: NarrationAxisType;
  workspaceLabel: string;
}): string {
  const labels = axisInstances(params.axisType);
  const axisName =
    params.axisType === 'zodiac' ? '띠' : params.axisType === 'constellation' ? '별자리' : '연령대';
  const instanceLines = labels.map((i) => `- ${i.label}`).join('\n');
  const titleBlock = buildTitlePromptBlock(params.axisType, params.topicLabel);

  return `한국어 숏폼 나레이션 대본(전체커버형)을 작성하라. 브루(Vrew) TTS용.

서비스: ${params.workspaceLabel}
주제(상품): ${params.topicLabel}
축: ${axisName} — 아래 ${labels.length}개 **전부** 1~2문장씩 다룰 것.

${params.topicContext}

포함할 ${axisName} (${labels.length}개 전부):
${instanceLines}

${titleBlock}

규칙:
- JSON: {"title":"...","body":"..."} 만 출력
- 본문: 오프닝 1~2문장 후 각 인스턴스를 "쥐띠:" 또는 "양자리:" 형식으로 짧게
- 각 인스턴스 1~2문장, 전체 1분30초 내외(한국어 350~480자)
- **본문 빈 줄 금지** — 문장·항목 사이 빈 줄 없이 줄바꿈 1번만
- 숫자는 아라비아 숫자(7, 12, 3개월) 그대로 — TTS가 처리함
- CTA·가입·크레딧·결제 유도 문구 **쓰지 말 것** (시스템이 붙임)
- 따옴표로 전체를 감싸지 말 것`;
}

export function buildRankedPrompt(params: {
  topicLabel: string;
  topicContext: string;
  axisType: NarrationAxisType;
  workspaceLabel: string;
}): string {
  const labels = axisInstances(params.axisType);
  const axisName =
    params.axisType === 'zodiac' ? '띠' : params.axisType === 'constellation' ? '별자리' : '연령대';
  const pool = labels.map((i) => i.label).join(', ');
  const titleBlock = buildTitlePromptBlock(params.axisType, params.topicLabel);

  return `한국어 숏폼 나레이션 대본(순위특집형 TOP5)을 작성하라. 브루 TTS용.

서비스: ${params.workspaceLabel}
주제(상품): ${params.topicLabel}
축: ${axisName}

${params.topicContext}

후보 풀: ${pool}

${titleBlock}

규칙:
- 제목: TOP5 + 축(띠/별자리/연령대) + 후킹 (예: "별자리로 알아보는 ○○ TOP5, 1위는?")
- 오프닝은 **강한 후킹** (궁금증)
- 5위→4위→3위→2위→1위 순서, 각 1~2문장
- 1위는 "그리고 1위는..." 같은 서스펜스 후 공개
- ${axisName} 5개만 선택 (LLM 자유 선정)
- **본문 빈 줄 금지** — 항목 사이 빈 줄 없이 줄바꿈 1번만
- 전체 1분30초~2분(400~520자)
- 숫자는 아라비아 숫자 그대로
- CTA **금지** (시스템 append)
- JSON만: {"title":"...","body":"..."}`;
}
