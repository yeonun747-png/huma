/** 본문 서비스 언급 — 발행 strip 대상 아님 (yeonun.com 단독·https 금지) */
export const YEONUN_BODY_LINK_LABEL = ' 연운 (yeonun . com) ';

/** 연운 네이버 블로그 기본 문체 — 계정별 blogWritingPersona 미설정 시 fallback */
export const DEFAULT_YEONUN_BLOG_WRITING_PERSONA = `[연운 블로그 문체]
- 반드시 ~요체로 가볍고 친근하게 (친구에게 카톡하듯)
- AI·마케팅 티 금지: 「정리했습니다」「안내합니다」「살펴보겠습니다」「흐름과 실천 포인트」 같은 문장 쓰지 말 것
- 본인 경험담·솔직한 반응·짧은 추임새(ㅎㅎ, ㅠㅠ)를 자연스럽게
- 짧은 문장·줄바꿈으로 블로그 가독성
- 서비스 언급은 「 연운 (yeonun . com) 」 형식만 본문에 2~3회 (앞뒤 공백·yeonun . com 점 앞뒤 공백 그대로, yeonun.com/https·전체 URL 금지)
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
