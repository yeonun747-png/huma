import type { Workspace } from './account';
import type { VideoPersonaConfig } from './video-content';

/** 인식 가능한 ## 섹션 헤더 (7종) */
export const VIDEO_PERSONA_KNOWN_HEADERS = [
  '관계축',
  '상황축',
  '감정곡선',
  '펀치라인 메커니즘',
  '컷 구성',
  '샷 구조',
  '싱글샷 구조',
  '서비스 제약',
] as const;

export type VideoPersonaKnownHeader = (typeof VIDEO_PERSONA_KNOWN_HEADERS)[number];

/** 연운·퀴즈오아시스 필수 섹션 (상황축 제외) */
export const VIDEO_PERSONA_REQUIRED_STANDARD: VideoPersonaKnownHeader[] = [
  '관계축',
  '감정곡선',
  '펀치라인 메커니즘',
  '컷 구성',
  '샷 구조',
  '서비스 제약',
];

/** 파나나 필수 섹션 (상황축 포함 7종) */
export const VIDEO_PERSONA_REQUIRED_PANANA: VideoPersonaKnownHeader[] = [
  '관계축',
  '상황축',
  '감정곡선',
  '펀치라인 메커니즘',
  '컷 구성',
  '샷 구조',
  '서비스 제약',
];

const KNOWN_HEADER_SET = new Set<string>(VIDEO_PERSONA_KNOWN_HEADERS);

export function isVideoPersonaKnownHeader(header: string): header is VideoPersonaKnownHeader {
  return KNOWN_HEADER_SET.has(header);
}

export function getVideoPersonaRequiredSections(workspace: Workspace): VideoPersonaKnownHeader[] {
  return workspace === 'panana' ? VIDEO_PERSONA_REQUIRED_PANANA : VIDEO_PERSONA_REQUIRED_STANDARD;
}

export function getVideoPersonaSectionGuide(workspace: Workspace): string {
  const sections =
    workspace === 'panana'
      ? '## 관계축 / ## 상황축 / ## 감정곡선 / ## 펀치라인 메커니즘 / ## 컷 구성 / ## 샷 구조 / ## 서비스 제약'
      : '## 관계축 / ## 감정곡선 / ## 펀치라인 메커니즘 / ## 컷 구성 / ## 샷 구조 / ## 서비스 제약';
  return sections;
}

function linesToArray(body: string): string[] {
  return body
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

/** 서술형 가이드 — 펀치라인 선택 옵션이 아님 */
function looksLikeHookTypeGuidanceLine(line: string): boolean {
  if (line.length > 36) return true;
  if (/[.?!…]/.test(line) && line.length > 14) return true;
  if (
    /(?:한다|합니다|세요|금지|기본으로|원칙|절대|해야|하지\s*말|보며|직시|카메라|전달|간접|정곡)/u.test(line)
  ) {
    return true;
  }
  return false;
}

function normalizeHookTypeOptionLine(line: string): string {
  const letterBullet = line.match(/^(?:[A-Za-z]|[0-9]+)[.)]\s*(.+)$/);
  if (letterBullet) return letterBullet[1]!.trim();
  const dashBullet = line.match(/^[-*•]\s*(.+)$/);
  if (dashBullet) return dashBullet[1]!.trim();
  return line;
}

/** 펀치라인 메커니즘 섹션 — 짧은 선택지 vs 서술형 원칙 분리 */
export function parseHookTypeSection(body: string): {
  hookTypes: string[];
  hookTypeGuidance: string;
} {
  const hookTypes: string[] = [];
  const guidanceLines: string[] = [];

  for (const line of linesToArray(body)) {
    const letterBullet = /^(?:[A-Za-z]|[0-9]+)[.)]\s*\S/.test(line);
    const dashBullet = /^[-*•]\s*\S/.test(line) && line.length <= 48;
    const plainOption = line.length <= 28 && !looksLikeHookTypeGuidanceLine(line);

    if (letterBullet || (dashBullet && !looksLikeHookTypeGuidanceLine(line)) || plainOption) {
      hookTypes.push(normalizeHookTypeOptionLine(line));
    } else {
      guidanceLines.push(line);
    }
  }

  return { hookTypes, hookTypeGuidance: guidanceLines.join('\n') };
}

/** 저장된 hookTypes 배열에 섞인 가이드 문장 제거 (재저장 없이 런타임 방어) */
export function sanitizeHookTypeOptions(hookTypes: string[] | undefined): string[] {
  if (!hookTypes?.length) return [];
  return hookTypes
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => {
      const letterBullet = /^(?:[A-Za-z]|[0-9]+)[.)]\s*\S/.test(line);
      const dashBullet = /^[-*•]\s*\S/.test(line) && line.length <= 48;
      const plainOption = line.length <= 28 && !looksLikeHookTypeGuidanceLine(line);
      return letterBullet || (dashBullet && !looksLikeHookTypeGuidanceLine(line)) || plainOption;
    })
    .map(normalizeHookTypeOptionLine);
}

export function splitHookTypeGuidanceFromOptions(
  hookTypes: string[] | undefined,
  hookTypeGuidance?: string,
): { hookTypes: string[]; hookTypeGuidance: string } {
  const guidanceParts: string[] = [];
  if (hookTypeGuidance?.trim()) guidanceParts.push(hookTypeGuidance.trim());

  const options: string[] = [];
  for (const line of hookTypes ?? []) {
    const t = line.trim();
    if (!t) continue;
    if (looksLikeHookTypeGuidanceLine(t) && !/^(?:[A-Za-z]|[0-9]+)[.)]\s*/.test(t)) {
      guidanceParts.push(t);
    } else {
      options.push(normalizeHookTypeOptionLine(t));
    }
  }

  const sanitized = sanitizeHookTypeOptions(options);
  return {
    hookTypes: sanitized.length ? sanitized : options.filter((l) => l.length <= 28),
    hookTypeGuidance: guidanceParts.join('\n'),
  };
}

function emptyConfig(): VideoPersonaConfig {
  return {
    relationshipAxes: [],
    situationAxes: [],
    emotionCurves: [],
    hookTypes: [],
    hookTypeGuidance: '',
    cutTypeRule: '',
    shotStructure: '',
    singleShotStructure: '',
    serviceConstraints: '',
  };
}

/** ## 헤더 기준 — 알려진/알 수 없는 섹션 분리 */
export function splitVideoPersonaSections(text: string): {
  known: Partial<Record<VideoPersonaKnownHeader, string>>;
  unknownHeaders: string[];
} {
  const known: Partial<Record<VideoPersonaKnownHeader, string>> = {};
  const unknownHeaders: string[] = [];
  const regex = /^##\s*(.+?)\s*$/gm;
  const matches = [...text.matchAll(regex)];

  for (let i = 0; i < matches.length; i++) {
    const rawHeader = matches[i]![1]!.trim();
    if (!rawHeader) continue;
    const start = matches[i]!.index! + matches[i]![0].length;
    const end = i + 1 < matches.length ? matches[i + 1]!.index! : text.length;
    const body = text.slice(start, end).trim();

    if (isVideoPersonaKnownHeader(rawHeader)) {
      known[rawHeader] = body;
    } else {
      unknownHeaders.push(rawHeader);
    }
  }

  return { known, unknownHeaders };
}

function applyKnownSection(config: VideoPersonaConfig, header: VideoPersonaKnownHeader, body: string): void {
  switch (header) {
    case '관계축':
      config.relationshipAxes = linesToArray(body);
      break;
    case '상황축':
      config.situationAxes = linesToArray(body);
      break;
    case '감정곡선':
      config.emotionCurves = linesToArray(body);
      break;
    case '펀치라인 메커니즘': {
      const parsed = parseHookTypeSection(body);
      config.hookTypes = parsed.hookTypes;
      config.hookTypeGuidance = parsed.hookTypeGuidance;
      break;
    }
    case '컷 구성':
      config.cutTypeRule = body;
      break;
    case '샷 구조':
      config.shotStructure = body;
      break;
    case '싱글샷 구조':
      config.singleShotStructure = body;
      break;
    case '서비스 제약':
      config.serviceConstraints = body;
      break;
  }
}

export function parseVideoPersonaText(
  text: string,
  workspace: Workspace,
): {
  config: VideoPersonaConfig;
  missingSections: VideoPersonaKnownHeader[];
  unknownSections: string[];
} {
  const { known, unknownHeaders } = splitVideoPersonaSections(text);
  const config = emptyConfig();

  for (const header of VIDEO_PERSONA_KNOWN_HEADERS) {
    if (known[header] !== undefined) {
      applyKnownSection(config, header, known[header]!);
    }
  }

  const required = getVideoPersonaRequiredSections(workspace);
  const missingSections: VideoPersonaKnownHeader[] = [];

  for (const header of required) {
    const body = known[header] ?? '';
    const isEmpty =
      header === '컷 구성' || header === '샷 구조' || header === '서비스 제약'
        ? !body.trim()
        : header === '펀치라인 메커니즘'
          ? parseHookTypeSection(body).hookTypes.length === 0
          : linesToArray(body).length === 0;
    if (isEmpty) missingSections.push(header);
  }

  return { config, missingSections, unknownSections: unknownHeaders };
}

/** 저장된 페르소나 → textarea (워크스페이스별 섹션 순서) */
export function serializeVideoPersonaText(cfg: Partial<VideoPersonaConfig>, workspace: Workspace): string {
  const blocks: string[][] = [['## 관계축', ...(cfg.relationshipAxes ?? [])]];

  if (workspace === 'panana' && (cfg.situationAxes?.length ?? 0) > 0) {
    blocks.push(['## 상황축', ...(cfg.situationAxes ?? [])]);
  }

  blocks.push(
    ['## 감정곡선', ...(cfg.emotionCurves ?? [])],
    [
      '## 펀치라인 메커니즘',
      ...(cfg.hookTypes ?? []),
      ...(cfg.hookTypeGuidance?.trim() ? ['', cfg.hookTypeGuidance.trim()] : []),
    ],
    ['## 컷 구성', cfg.cutTypeRule ?? ''],
    ['## 샷 구조', cfg.shotStructure ?? ''],
    ...(cfg.singleShotStructure?.trim()
      ? [['## 싱글샷 구조', cfg.singleShotStructure.trim()]]
      : []),
    ['## 서비스 제약', cfg.serviceConstraints ?? ''],
  );

  return blocks.map((block) => block.join('\n')).join('\n\n').trimEnd();
}

export function hasStoredVideoPersona(cfg: Partial<VideoPersonaConfig> | null | undefined): boolean {
  if (!cfg) return false;
  return (
    (cfg.relationshipAxes?.length ?? 0) > 0 ||
    (cfg.situationAxes?.length ?? 0) > 0 ||
    (cfg.emotionCurves?.length ?? 0) > 0 ||
    (cfg.hookTypes?.length ?? 0) > 0 ||
    Boolean(cfg.hookTypeGuidance?.trim()) ||
    Boolean(cfg.cutTypeRule?.trim()) ||
    Boolean(cfg.shotStructure?.trim()) ||
    Boolean(cfg.singleShotStructure?.trim()) ||
    Boolean(cfg.serviceConstraints?.trim())
  );
}
