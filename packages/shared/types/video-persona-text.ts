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

/** 관계축·감정곡선 등 선택지 라벨 최대 길이 */
export const MAX_PERSONA_AXIS_OPTION_LEN = 24;
/** hook_type 라벨 최대 길이 */
export const MAX_HOOK_TYPE_LABEL_LEN = 16;
/** `반전 — 설명` 형식에서 인정하는 라벨 최대 길이 */
const MAX_HOOK_EMDASH_LABEL_LEN = 10;

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

function dedupeOptions(options: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const o of options) {
    const key = o.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

function splitAtFirstBlankParagraph(body: string): { head: string; tail: string } {
  const idx = body.search(/\n\s*\n/);
  if (idx < 0) return { head: body.trim(), tail: '' };
  return {
    head: body.slice(0, idx).trim(),
    tail: body.slice(idx).trim(),
  };
}

function normalizeBulletOptionLine(line: string): string {
  const letterBullet = line.match(/^(?:[A-Za-z]|[0-9]+)[.)]\s*(.+)$/);
  if (letterBullet) return letterBullet[1]!.trim();
  const dashBullet = line.match(/^[-*•]\s*(.+)$/);
  if (dashBullet) return dashBullet[1]!.trim();
  return line.trim();
}

/** 서술형·금지 예시 — 선택 옵션이 아님 */
function looksLikePersonaGuidanceLine(line: string): boolean {
  if (line.length > MAX_PERSONA_AXIS_OPTION_LEN) return true;
  if (/["'「『""'']/.test(line)) return true;
  if (/[.?!…]/.test(line) && line.length > 14) return true;
  if (
    /(?:식의|금지|예시|원칙|한다|합니다|세요|절대|해야|하지\s*말|보며|직시|카메라|전달|간접|보인|적혀|캡처|확인서|나쁜|좋은)/u.test(
      line,
    )
  ) {
    return true;
  }
  return false;
}

export function isValidPersonaOptionLabel(label: string): boolean {
  const t = label.trim();
  if (!t || t.length > MAX_PERSONA_AXIS_OPTION_LEN) return false;
  return !looksLikePersonaGuidanceLine(t);
}

export function isValidHookTypeLabel(label: string): boolean {
  const t = label.trim();
  if (!t || t.length > MAX_HOOK_TYPE_LABEL_LEN) return false;
  return isValidPersonaOptionLabel(t);
}

export function filterValidPersonaOptions(options: string[] | undefined): string[] {
  return dedupeOptions((options ?? []).map((o) => normalizeBulletOptionLine(o)).filter(isValidPersonaOptionLabel));
}

export function filterValidHookTypeOptions(options: string[] | undefined): string[] {
  return dedupeOptions(
    (options ?? []).map((o) => normalizeHookTypeOptionLine(o)).filter(isValidHookTypeLabel),
  );
}

function isAxisOptionLine(line: string): boolean {
  if (/^(?:[A-Za-z]|[0-9]+)[.)]\s*\S/.test(line)) return true;
  if (/^[-*•]\s*\S/.test(line)) {
    const inner = normalizeBulletOptionLine(line);
    return inner.length <= MAX_PERSONA_AXIS_OPTION_LEN && !looksLikePersonaGuidanceLine(inner);
  }
  if (line.length > MAX_PERSONA_AXIS_OPTION_LEN) return false;
  if (looksLikePersonaGuidanceLine(line)) return false;
  const emDash = line.match(/^(.+?)\s*[—–\-]\s/);
  if (emDash && emDash[1]!.trim().length > MAX_HOOK_EMDASH_LABEL_LEN) return false;
  return true;
}

/** 관계축·감정곡선·상황축 — 선택지 vs 설명 분리 */
export function parseAxisOptionSection(body: string): { options: string[]; guidance: string } {
  const { head, tail } = splitAtFirstBlankParagraph(body);
  const options: string[] = [];
  const guidanceLines: string[] = [];

  for (const line of linesToArray(head)) {
    if (isAxisOptionLine(line)) {
      const label = normalizeBulletOptionLine(line);
      const emDash = label.match(/^(.+?)\s*[—–\-]\s*(.+)$/);
      options.push(emDash ? emDash[1]!.trim() : label);
    } else {
      guidanceLines.push(line);
    }
  }

  if (tail) guidanceLines.push(tail);
  return {
    options: filterValidPersonaOptions(options),
    guidance: guidanceLines.join('\n').trim(),
  };
}

function normalizeHookTypeOptionLine(line: string): string {
  const normalized = normalizeBulletOptionLine(line);
  const emDash = normalized.match(/^(.+?)\s*[—–\-]\s/);
  if (emDash) return emDash[1]!.trim();
  return normalized;
}

function extractHookTypeFromLine(line: string, letterBulletMode: boolean): string | null {
  if (letterBulletMode) {
    if (/^(?:[A-Za-z]|[0-9]+)[.)]\s*\S/.test(line)) {
      return normalizeHookTypeOptionLine(line);
    }
    return null;
  }

  const emDash = line.match(/^(.{2,10})\s*[—–\-]\s/);
  if (emDash) {
    const label = emDash[1]!.trim();
    if (label.length <= MAX_HOOK_EMDASH_LABEL_LEN && isValidHookTypeLabel(label)) return label;
    return null;
  }

  if (/^(?:[A-Za-z]|[0-9]+)[.)]\s*\S/.test(line)) {
    return normalizeHookTypeOptionLine(line);
  }

  if (line.length <= 12 && isValidHookTypeLabel(line)) {
    return normalizeHookTypeOptionLine(line);
  }

  return null;
}

/** 펀치라인 메커니즘 — 선택지 vs 서술형 원칙 분리 */
export function parseHookTypeSection(body: string): {
  hookTypes: string[];
  hookTypeGuidance: string;
} {
  const { head, tail } = splitAtFirstBlankParagraph(body);
  const headLines = linesToArray(head);
  const letterBulletMode = headLines.some((line) => /^[A-Za-z][.)]\s*\S/.test(line));

  const hookTypes: string[] = [];
  const guidanceLines: string[] = [];

  for (const line of headLines) {
    const option = extractHookTypeFromLine(line, letterBulletMode);
    if (option) hookTypes.push(option);
    else guidanceLines.push(line);
  }

  if (tail) guidanceLines.push(tail);

  return {
    hookTypes: filterValidHookTypeOptions(hookTypes),
    hookTypeGuidance: guidanceLines.join('\n').trim(),
  };
}

/** 저장된 hookTypes 배열에 섞인 가이드 문장 제거 (재저장 없이 런타임 방어) */
export function sanitizeHookTypeOptions(hookTypes: string[] | undefined): string[] {
  return filterValidHookTypeOptions(hookTypes);
}

export function splitHookTypeGuidanceFromOptions(
  hookTypes: string[] | undefined,
  hookTypeGuidance?: string,
): { hookTypes: string[]; hookTypeGuidance: string } {
  const guidanceParts: string[] = [];
  if (hookTypeGuidance?.trim()) guidanceParts.push(hookTypeGuidance.trim());

  for (const line of hookTypes ?? []) {
    const t = line.trim();
    if (!t) continue;
    if (isValidHookTypeLabel(normalizeHookTypeOptionLine(t))) {
      continue;
    }
    guidanceParts.push(t);
  }

  const validFromArray = filterValidHookTypeOptions(hookTypes);
  return {
    hookTypes: validFromArray,
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
    case '관계축': {
      const parsed = parseAxisOptionSection(body);
      config.relationshipAxes = parsed.options;
      break;
    }
    case '상황축': {
      const parsed = parseAxisOptionSection(body);
      config.situationAxes = parsed.options;
      break;
    }
    case '감정곡선': {
      const parsed = parseAxisOptionSection(body);
      config.emotionCurves = parsed.options;
      break;
    }
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
          : header === '관계축'
            ? parseAxisOptionSection(body).options.length === 0
            : header === '감정곡선'
              ? parseAxisOptionSection(body).options.length === 0
              : header === '상황축'
                ? parseAxisOptionSection(body).options.length === 0
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
