/** EvoLink Kling 3.0 Turbo — prompt 파라미터 최대 길이 (한글/영문 동일) */
export const EVOLINK_PROMPT_MAX_LENGTH = 2500;

/** 길이 초과 시 Sonnet 재요청 최대 횟수 */
export const MAX_PROMPT_LENGTH_RETRIES = 2;

export const PROMPT_LENGTH_REGENERATION_FEEDBACK =
  '생성된 콘티가 너무 길다, 각 샷의 묘사를 더 간결하게 줄여서 전체 프롬프트가 2500자 이내가 되도록 다시 작성하라';

export const EVOLINK_PROMPT_LENGTH_GUIDANCE =
  '최종 변환된 전체 프롬프트는 2500자를 초과할 수 없으므로, 각 샷의 묘사는 간결하고 핵심적인 표현으로 작성한다.';

export function evoLinkPromptLength(prompt: string): number {
  return prompt.length;
}

export function isEvoLinkPromptWithinLimit(prompt: string): boolean {
  return prompt.length <= EVOLINK_PROMPT_MAX_LENGTH;
}

export function assertEvoLinkPromptLength(prompt: string): void {
  if (!isEvoLinkPromptWithinLimit(prompt)) {
    throw new Error(`EvoLink prompt 길이 초과: ${prompt.length}자 (최대 ${EVOLINK_PROMPT_MAX_LENGTH}자)`);
  }
}
