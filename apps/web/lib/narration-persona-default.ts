import type { NarrationScriptWorkspace } from '@huma/shared';

/** @huma/shared/types/narration-persona — dist 미빌드 시에도 웹 번들에 포함 */
export {
  buildDefaultNarrationPersonaText,
  NARRATION_PERSONA_SECTION_GUIDE,
} from '../../../packages/shared/types/narration-persona';

import { buildDefaultNarrationPersonaText } from '../../../packages/shared/types/narration-persona';

const YEONUN_FALLBACK =
  '당신은 연운(yeonun.com)의 AI 운세 대본 작가입니다.\n\n# 정체성\n사주명리 기반 숏폼 MC 페르소나';
const FORTUNE82_FALLBACK =
  '당신은 포춘82(fortune82.com)의 AI 운세 대본 작가입니다.\n\n# 정체성\n정통 사주·타로 숏폼 MC 페르소나';

/** shared 빈 반환 시 최소 기본값 */
export function resolveNarrationPersonaDefaultText(service: NarrationScriptWorkspace): string {
  const text = buildDefaultNarrationPersonaText(service)?.trim();
  return text || (service === 'fortune82' ? FORTUNE82_FALLBACK : YEONUN_FALLBACK);
}
