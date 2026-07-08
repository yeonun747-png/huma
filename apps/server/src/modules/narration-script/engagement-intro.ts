import type {
  NarrationAxisType,
  NarrationFormatType,
  NarrationScriptWorkspace,
} from '@huma/shared';
import { axisInstanceLabels } from './axis-instances.js';

const BLESSING_RULES: Array<{ pattern: RegExp; yeonun: string; fortune82: string }> = [
  {
    pattern: /재물|금전|돈|부자|재테크|자산|수입|당첨/i,
    yeonun: '큰 재물복이 들어와요',
    fortune82: '큰 재물복이 들어옵니다',
  },
  {
    pattern: /연애|재회|결혼|인연|애정|짝|궁합/i,
    yeonun: '좋은 인연이 찾아와요',
    fortune82: '좋은 인연이 찾아옵니다',
  },
  {
    pattern: /건강|질병|회복|컨디션/i,
    yeonun: '건강과 활력이 찾아와요',
    fortune82: '건강과 활력이 찾아옵니다',
  },
  {
    pattern: /취업|직장|승진|사업|이직|커리어/i,
    yeonun: '원하는 성과가 찾아와요',
    fortune82: '원하는 성과가 찾아옵니다',
  },
  {
    pattern: /시험|합격|수능|면접/i,
    yeonun: '합격운과 행운이 찾아와요',
    fortune82: '합격운과 행운이 찾아옵니다',
  },
  {
    pattern: /학업|공부|진학/i,
    yeonun: '학업운이 크게 열려요',
    fortune82: '학업운이 크게 열립니다',
  },
];

function engagementAxisLabel(axisType: NarrationAxisType): string {
  if (axisType === 'zodiac') return '띠';
  if (axisType === 'constellation') return '별자리';
  return '연령';
}

function buildEngagementBlessing(
  topicLabel: string,
  workspace: NarrationScriptWorkspace,
): string {
  const topic = topicLabel.trim();
  for (const rule of BLESSING_RULES) {
    if (rule.pattern.test(topic)) {
      return workspace === 'fortune82' ? rule.fortune82 : rule.yeonun;
    }
  }
  return workspace === 'fortune82' ? '큰 행운이 찾아옵니다' : '큰 행운이 찾아와요';
}

/** 댓글·더블탭 유도 — 오프닝 직후 시스템 삽입 */
export function buildNarrationEngagementIntro(opts: {
  axisType: NarrationAxisType;
  topicLabel: string;
  workspace: NarrationScriptWorkspace;
}): string {
  const axis = engagementAxisLabel(opts.axisType);
  const blessing = buildEngagementBlessing(opts.topicLabel, opts.workspace);
  const wish =
    opts.workspace === 'fortune82'
      ? `소원을 적으시면 ${blessing}.`
      : `소원을 적어 주시면 ${blessing}.`;

  return `화면을 두번터치하고 댓글에 자신의 ${axis}와 ${wish}`;
}

function findEngagementInsertIndex(
  body: string,
  axisType: NarrationAxisType,
  formatType: NarrationFormatType,
  rankedTopN = 5,
): number {
  if (formatType === 'ranked') {
    for (let rank = rankedTopN; rank >= 1; rank--) {
      const pattern = new RegExp(`${rank}\\s*위|${rank}위`);
      const m = body.match(pattern);
      if (m?.index != null && m.index > 0) return m.index;
    }
  }

  const labels = axisInstanceLabels(axisType);
  let earliest = body.length;
  for (const label of labels) {
    for (const token of [`${label}:`, `${label} `]) {
      const idx = body.indexOf(token);
      if (idx > 0 && idx < earliest) earliest = idx;
    }
  }
  if (earliest < body.length) return earliest;

  const sentence = body.match(/^[\s\S]+?[.!?](?=\s|\n|$)/);
  if (sentence && sentence[0].length > 0 && sentence[0].length < body.length) {
    return sentence[0].length;
  }

  return 0;
}

/** LLM 오프닝 뒤에 댓글 유도 문구 삽입 */
export function insertNarrationEngagementIntro(
  body: string,
  opts: {
    axisType: NarrationAxisType;
    formatType: NarrationFormatType;
    topicLabel: string;
    workspace: NarrationScriptWorkspace;
    rankedTopN?: number;
  },
): string {
  const trimmed = body.trim();
  if (!trimmed) return buildNarrationEngagementIntro(opts);
  if (/화면을\s*두\s*번?\s*터치|화면을\s*두번터치/i.test(trimmed)) return trimmed;

  const intro = buildNarrationEngagementIntro(opts);
  const idx = findEngagementInsertIndex(
    trimmed,
    opts.axisType,
    opts.formatType,
    opts.rankedTopN ?? 5,
  );

  if (idx <= 0) return `${intro}\n${trimmed}`;

  const before = trimmed.slice(0, idx).trimEnd();
  const after = trimmed.slice(idx).trimStart();
  return `${before}\n${intro}\n${after}`;
}
