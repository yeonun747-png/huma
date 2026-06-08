/**
 * 모든 사람이 읽는 텍스트(포스팅·댓글·카페 글)에 공통 적용.
 * 추상적 "사람처럼"이 아니라 AI 탐지기가 잡는 구체적 신호를 제거하는 규칙.
 * 댓글 등 짧은 글에도 안전하도록 길이를 가정하지 않는다.
 */
export const HUMAN_WRITING_MANDATE = [
  '사람이 직접 쓴 글이다. AI·마케터가 아니다.',
  '- 메타·요약 문장 금지: 「정리하면」「결론적으로」「살펴보겠습니다」「~를 안내합니다」「~를 소개합니다」 등.',
  '- 교과서식 완벽함 배제: 너무 매끄럽고 균일한 문장 대신 구어체·추임새(ㅎㅎ, ㅠㅠ, 헐, 진짜)를 자연스럽게.',
  '- 문장 길이를 일부러 들쭉날쭉하게(짧은 문장과 긴 문장 섞기). 가끔 말끝을 흐리거나(…) 여운을 남겨도 됨.',
  '- AI 특유의 균형 잡힌 나열·과한 접속사("또한", "더불어", "뿐만 아니라") 자제.',
  '- 감정·주관을 직접 드러낼 것(좋다/싫다/놀랐다). 일반론보다 구체적 디테일.',
].join('\n');

/** 블로그 본문 등 장문 전용 추가 규칙 — 댓글에는 적용하지 않는다. */
export const HUMAN_LONGFORM_RULES = [
  '[장문 작성 규칙]',
  '- 소제목·번호 목록·불릿으로 정돈하지 말 것. 사람 블로그처럼 자연스러운 문단 흐름으로.',
  '- 첫 문단은 정보 요약이 아니라 본인의 구체적 경험·상황·계기로 시작(예: "요즘 ~때문에 고민이었는데").',
  '- 글 중간에 곁가지·딴 얘기를 살짝 섞어도 됨(사람은 한 주제로만 매끈하게 안 씀).',
  '- "마무리하며" 같은 정형 결론 대신, 가볍게 끝내거나 질문·다짐으로 자연스럽게 마칠 것.',
  '- 같은 단어·어미("~습니다"만 반복) 연속 사용 피하기.',
].join('\n');

export function withHumanWritingMandate(prompt: string): string {
  return `${prompt}\n\n[필수] ${HUMAN_WRITING_MANDATE}`;
}

export function withHumanWritingSystem(system: string): string {
  return `${system}\n[필수] ${HUMAN_WRITING_MANDATE}`;
}

/** 블로그 본문 프롬프트용 — 공용 mandate + 장문 규칙. */
export function withLongformWritingMandate(prompt: string): string {
  return `${prompt}\n\n[필수] ${HUMAN_WRITING_MANDATE}\n\n${HUMAN_LONGFORM_RULES}`;
}
