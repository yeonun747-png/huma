/** Sonnet/Haiku가 사람이 읽는 텍스트(포스팅·댓글·카페 글 등)를 쓸 때 모든 프롬프트에 포함 */
export const HUMAN_WRITING_MANDATE = '반드시 사람처럼 생각하고 작성할 것!';

export function withHumanWritingMandate(prompt: string): string {
  return `${prompt}\n\n[필수] ${HUMAN_WRITING_MANDATE}`;
}

export function withHumanWritingSystem(system: string): string {
  return `${system}\n[필수] ${HUMAN_WRITING_MANDATE}`;
}
