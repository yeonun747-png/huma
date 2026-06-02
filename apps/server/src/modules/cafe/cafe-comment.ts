import type { Page } from 'playwright';
import { askClaudeWithModel } from '../../lib/anthropic-client.js';
import { getSubClaudeModel } from '../../lib/ai-engine.js';
import { withHumanWritingMandate } from '../../lib/ai-human-writing.js';
import { getCafeViralConfig } from '../../lib/cafe-viral-config.js';
import type { AccountPersona } from '../playwright/persona.js';

const HAIKU_FALLBACK = 'claude-haiku-4-5-20251001';

export interface CafeArticleExcerpt {
  title: string;
  excerpt: string;
}

export type CafeCommentStyle = 'viral' | 'activity';

export async function extractCafeArticle(page: Page): Promise<CafeArticleExcerpt> {
  await page.waitForLoadState('networkidle').catch(() => {});
  const frame = page.frame({ name: 'cafe_main' });
  const roots = frame ? [frame, page] : [page];

  let title = '';
  let body = '';
  for (const root of roots) {
    if (!title) {
      title =
        (await root.locator('.title_text, .article_title, .ArticleTitle, h3.title, .tit_area').first().textContent().catch(() => '')) ??
        '';
    }
    if (!body) {
      body =
        (await root
          .locator('.article_viewer, .ContentRenderer, .se-main-container, .article_container, #app')
          .first()
          .textContent()
          .catch(() => '')) ?? '';
    }
  }

  return {
    title: title.replace(/\s+/g, ' ').trim(),
    excerpt: body.replace(/\s+/g, ' ').trim().slice(0, 800),
  };
}

async function callHaikuComment(prompt: string, maxTokens: number): Promise<string | null> {
  const model = (await getSubClaudeModel()) || HAIKU_FALLBACK;
  const mandated = withHumanWritingMandate(prompt);
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await askClaudeWithModel({
      model,
      max_tokens: maxTokens,
      prompt: attempt === 1 ? `${mandated}\n\n(다시 한 번, 더 자연스럽게)` : mandated,
    });
    const text = raw?.trim().replace(/^["']|["']$/g, '');
    if (text && text.length >= 4 && text.length <= 400) return text;
  }
  return null;
}

/** Haiku — 카페 댓글 통합 (viral / activity) */
export async function generateCafeComment(params: {
  title: string;
  excerpt?: string;
  workspace?: string;
  style: CafeCommentStyle;
  persona?: Partial<AccountPersona> & { gender?: string; occupation?: string };
  cafeCategory?: string;
}): Promise<string> {
  const config = await getCafeViralConfig();
  const age = params.persona?.age ?? 32;
  const gender = params.persona?.gender ?? '여성';
  const title = params.title.trim();
  const excerpt = (params.excerpt ?? '').trim();

  if (!title && !excerpt) {
    throw new Error('카페 댓글 생성: 제목·본문 없음');
  }

  const serviceHint =
    params.style === 'viral' && params.workspace === 'yeonun'
      ? '- "사주 앱 써봤는데" 또는 "점 봤더니" 형식의 간접 경험담 가능 (서비스명 직접 언급 금지)\n'
      : '- 서비스·앱·사이트 언급 절대 금지\n';

  const styleGuide = params.style === 'viral' ? config.reply_style : '공감·경험 공유형';
  const emojiRule = params.style === 'viral' ? '이모지 1~2개' : '이모지 0~1개 (없어도 됨)';
  const sentenceRule = params.style === 'viral' ? '2~3문장' : '1~3문장';

  const prompt = `너는 ${age}세 ${gender} 네이버 카페 일반 회원이야.
아래 게시글을 읽고 ${styleGuide} 댓글을 달아줘.

제목: "${title}"
${excerpt ? `본문 일부: "${excerpt}"` : ''}
${params.cafeCategory ? `카테고리: ${params.cafeCategory}` : ''}

규칙:
- 본문 내용에 직접 반응 (공감·질문·경험 공유 중 하나)
${serviceHint}- 서비스명(연운, 퀴즈오아시스, 파나나 등) 직접 언급 금지
- ${sentenceRule}, 구어체, ${emojiRule}
- 광고처럼 보이면 안 됨
- 댓글 텍스트만 출력`;

  const result = await callHaikuComment(prompt, params.style === 'viral' ? 300 : 200);
  if (!result) {
    throw new Error(`카페 댓글 AI 생성 실패: "${title.slice(0, 40)}"`);
  }
  return result;
}

export async function generateCafeCommentFromPage(
  page: Page,
  params: Omit<Parameters<typeof generateCafeComment>[0], 'title' | 'excerpt'>,
): Promise<string> {
  const { title, excerpt } = await extractCafeArticle(page);
  return generateCafeComment({ ...params, title, excerpt });
}
