import type { Page } from 'playwright';
import { askClaudeWithModel } from '../../../lib/anthropic-client.js';
import { getSubClaudeModel } from '../../../lib/ai-engine.js';
import { withHumanWritingMandate } from '../../../lib/ai-human-writing.js';

const HAIKU_FALLBACK = 'claude-haiku-4-5-20251001';

async function extractBlogArticle(page: Page): Promise<{ title: string; excerpt: string }> {
  const title =
    (await page.locator('.se-title-text, .htitle').first().textContent().catch(() => '')) ?? '';
  const body =
    (await page.locator('.se-main-container, .post-view').first().textContent().catch(() => '')) ??
    '';
  return {
    title: title.replace(/\s+/g, ' ').trim(),
    excerpt: body.replace(/\s+/g, ' ').trim().slice(0, 500),
  };
}

/** v3.23 ㊱: 고정 템플릿 금지 — Haiku가 본문 읽고 실시간 생성 */
export async function generateCrankComment(page: Page): Promise<string> {
  const { title, excerpt } = await extractBlogArticle(page);

  if (!title && !excerpt) {
    throw new Error('블로그 댓글 생성: 제목·본문 추출 실패');
  }

  const prompt = withHumanWritingMandate(`네이버 블로그 독자로서 아래 게시글에 자연스러운 댓글을 달아줘.

제목: "${title}"
본문 일부: "${excerpt}"

규칙:
- 1~2문장, 구어체
- 본문 내용에 직접 반응 (공감·질문·경험 공유 중 하나)
- 서비스·앱·사이트 언급 절대 금지
- 광고처럼 보이면 안 됨
- 이모지 1개 이하 (없어도 됨)
- 댓글 텍스트만 출력`);

  const model = (await getSubClaudeModel()) || HAIKU_FALLBACK;
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await askClaudeWithModel({
      model,
      max_tokens: 120,
      prompt: attempt === 1 ? `${prompt}\n\n(다시 한 번, 더 자연스럽게)` : prompt,
    });
    const text = raw?.trim().replace(/^["']|["']$/g, '');
    if (text && text.length >= 4 && text.length <= 300) return text;
  }

  throw new Error(`블로그 댓글 AI 생성 실패: "${title.slice(0, 40)}"`);
}
