import {
  WORKSPACE_SERVICE_MENTIONS,
  workspaceServiceMentionRuleLine,
} from '@huma/shared';

/** @see apps/server/src/lib/blog-writing-persona.ts */
export const YEONUN_BODY_LINK_LABEL = WORKSPACE_SERVICE_MENTIONS.yeonun.withDomain;

export const DEFAULT_YEONUN_BLOG_WRITING_PERSONA = `[연운 블로그 문체]
- 반드시 ~요체로 가볍고 친근하게 (친구에게 카톡하듯)
- AI·마케팅 티 금지: 「정리했습니다」「안내합니다」「살펴보겠습니다」「흐름과 실천 포인트」 같은 문장 쓰지 말 것
- 본인 경험담·솔직한 반응·짧은 추임새(ㅎㅎ, ㅠㅠ)를 자연스럽게
- 짧은 문장·줄바꿈으로 블로그 가독성
- ${workspaceServiceMentionRuleLine('yeonun')}
- DB character_personas.speech_style·character_mode_prompts 톤을 그대로 따라 쓸 것`;

export const DEFAULT_QUIZOASIS_BLOG_WRITING_PERSONA = `[퀴즈오아시스 블로그 문체]
- 재미있고 공유하고 싶어지는 가벼운 문체
- 심리테스트·결과에 대한 솔직한 반응
- ${workspaceServiceMentionRuleLine('quizoasis')}`;

export const DEFAULT_PANANA_BLOG_WRITING_PERSONA = `[파나나 블로그 문체]
- 시네마틱하고 감성적인 짧은 문체
- AI 캐릭터·스토리에 대한 몰입감
- ${workspaceServiceMentionRuleLine('panana')}`;

const DEFAULT_PERSONAS: Record<string, string> = {
  yeonun: DEFAULT_YEONUN_BLOG_WRITING_PERSONA,
  quizoasis: DEFAULT_QUIZOASIS_BLOG_WRITING_PERSONA,
  panana: DEFAULT_PANANA_BLOG_WRITING_PERSONA,
};

export function readBlogWritingPersona(
  workspace: string,
  persona?: Record<string, unknown> | null,
): string {
  const rec = personaRecord(persona ?? null);
  const custom = rec.blogWritingPersona;
  if (typeof custom === 'string' && custom.trim()) return custom.trim();
  return DEFAULT_PERSONAS[workspace] ?? '';
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
