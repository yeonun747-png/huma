/** @see apps/server/src/lib/blog-writing-persona.ts */
export const YEONUN_BODY_LINK_LABEL = ' 연운 (yeonun . com) ';

export const DEFAULT_YEONUN_BLOG_WRITING_PERSONA = `[연운 블로그 문체]
- 반드시 ~요체로 가볍고 친근하게 (친구에게 카톡하듯)
- AI·마케팅 티 금지: 「정리했습니다」「안내합니다」「살펴보겠습니다」「흐름과 실천 포인트」 같은 문장 쓰지 말 것
- 본인 경험담·솔직한 반응·짧은 추임새(ㅎㅎ, ㅠㅠ)를 자연스럽게
- 짧은 문장·줄바꿈으로 블로그 가독성
- 서비스 언급은 「 연운 (yeonun . com) 」 형식만 본문에 2~3회 (앞뒤 공백·yeonun . com 점 앞뒤 공백 그대로, yeonun.com/https·전체 URL 금지)
- DB character_personas.speech_style·character_mode_prompts 톤을 그대로 따라 쓸 것`;

export function readBlogWritingPersona(
  workspace: string,
  persona?: Record<string, unknown> | null,
): string {
  const rec = personaRecord(persona ?? null);
  const custom = rec.blogWritingPersona;
  if (typeof custom === 'string' && custom.trim()) return custom.trim();
  if (workspace === 'yeonun') return DEFAULT_YEONUN_BLOG_WRITING_PERSONA;
  return '';
}

function personaRecord(raw: Record<string, unknown> | null | undefined): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return { ...raw };
  return {};
}

export function mergeBlogWritingPersona(
  persona: Record<string, unknown> | null | undefined,
  text: string,
): Record<string, unknown> {
  return { ...personaRecord(persona), blogWritingPersona: text.trim() };
}
