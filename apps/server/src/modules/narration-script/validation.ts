import type { NarrationAxisType, NarrationFormatType } from '@huma/shared';
import { axisInstanceLabels, axisInstances } from './axis-instances.js';

export interface GeneratedNarrationDraft {
  title: string;
  body: string;
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

  return `한국어 숏폼 나레이션 대본(전체커버형)을 작성하라. 브루(Vrew) TTS용.

서비스: ${params.workspaceLabel}
주제(상품): ${params.topicLabel}
축: ${axisName} — 아래 ${labels.length}개 **전부** 1~2문장씩 다룰 것.

${params.topicContext}

포함할 ${axisName} (${labels.length}개 전부):
${instanceLines}

규칙:
- 제목 1줄 + 본문(나레이션)만 JSON으로 출력
- 오프닝 1~2문장 후 각 인스턴스를 "쥐띠:" 또는 "양자리:" 형식으로 짧게
- 각 인스턴스 1~2문장, 전체 1분30초 내외(한국어 350~480자)
- 숫자는 아라비아 숫자(7, 12, 3개월) 그대로 — TTS가 처리함
- CTA·가입·크레딧·결제 유도 문구 **쓰지 말 것** (시스템이 붙임)
- 따옴표로 전체를 감싸지 말 것

JSON만:
{"title":"...","body":"..."}`;
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

  return `한국어 숏폼 나레이션 대본(순위특집형 TOP5)을 작성하라. 브루 TTS용.

서비스: ${params.workspaceLabel}
주제(상품): ${params.topicLabel}
축: ${axisName}

${params.topicContext}

후보 풀: ${pool}

규칙:
- 제목에 TOP5 느낌 (예: "이번 달 ○○ TOP5")
- 오프닝은 전체커버형보다 **더 강한 후킹** (궁금증)
- 5위→4위→3위→2위→1위 순서, 각 1~2문장
- 1위는 "그리고 1위는..." 같은 서스펜스 후 공개
- ${axisName} 5개만 선택 (LLM 자유 선정)
- 전체 1분30초~2분(400~520자)
- 숫자는 아라비아 숫자 그대로
- CTA **금지** (시스템 append)
- JSON만: {"title":"...","body":"..."}`;
}
