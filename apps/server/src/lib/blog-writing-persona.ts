/** 연운 네이버 블로그 기본 문체 — 계정별 blogWritingPersona 미설정 시 fallback */
export const DEFAULT_YEONUN_BLOG_WRITING_PERSONA = `[연운 블로그 문체]
- 반드시 ~요체로 가볍고 친근하게 (친구에게 카톡하듯)
- AI·마케팅 티 금지: 「정리했습니다」「안내합니다」「살펴보겠습니다」「흐름과 실천 포인트」 같은 문장 쓰지 말 것
- 본인 경험담·솔직한 반응·짧은 추임새(ㅎㅎ, ㅠㅠ)를 자연스럽게
- 짧은 문장·줄바꿈으로 블로그 가독성
- 연운 URL은 본문에 2~3회만 자연스럽게
- DB character_personas.speech_style·character_mode_prompts 톤을 그대로 따라 쓸 것`;

export function resolveBlogWritingPersona(
  workspace: string,
  accountPersona?: Record<string, unknown> | null,
): string | undefined {
  const custom = accountPersona?.blogWritingPersona;
  if (typeof custom === 'string' && custom.trim()) return custom.trim();
  if (workspace === 'yeonun') return DEFAULT_YEONUN_BLOG_WRITING_PERSONA;
  return undefined;
}
