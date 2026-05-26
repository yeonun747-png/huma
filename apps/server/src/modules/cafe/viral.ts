import type { Page } from 'playwright';
import { askClaudeWithModel } from '../../lib/anthropic-client.js';
import { getSubClaudeModel } from '../../lib/ai-engine.js';
import { supabase } from '../../middleware/auth.js';
import { randomBetween, sleep } from '../../lib/utils.js';
import {
  getCafeViralConfig,
  keywordsForWorkspace,
  normalizeCafePostUrl,
} from '../../lib/cafe-viral-config.js';
import { writeCafeReply } from '../playwright/naver/cafe.js';
import { getHumanEngineConfig } from '../../lib/settings.js';
import type { AccountPersona } from '../playwright/persona.js';

export interface CafePostHit {
  title: string;
  url: string;
  keyword?: string;
}

export interface GradeRequirements {
  greeting_post?: number;
  comment_count?: number;
  like_count?: number;
  posts?: number;
  note?: string;
}

const PRODUCT_TOPIC_MAP: Record<string, string> = {
  '그 사람은 지금 무슨 생각': '헤어진 사람 마음 궁금할 때',
  '미래 배우자운': '결혼 인연 걱정될 때',
  '재물보감': '재테크·이직 타이밍 고민',
  '커리어 사주 · 이직 · 승진': '취업·이직·승진 고민',
  '2026 신년운세': '올해 운세 막막할 때',
  '정통 사주풀이 종합': '사주 정밀 풀이 고민',
};

export async function generateViralReply(params: {
  postTitle: string;
  workspace: string;
  persona?: Partial<AccountPersona> & { gender?: string; occupation?: string };
}): Promise<string> {
  const config = await getCafeViralConfig();
  const age = params.persona?.age ?? 32;
  const gender = params.persona?.gender ?? '여성';
  const serviceHint =
    params.workspace === 'yeonun'
      ? '"사주 앱 써봤는데" 또는 "점 봤더니" 형식으로 간접 경험담 (서비스명 직접 언급 금지)'
      : '';

  const raw = await askClaudeWithModel({
    model: (await getSubClaudeModel()) || 'claude-haiku-4-5-20251001',
    max_tokens: 300,
    prompt: `너는 ${age}세 ${gender} 일반 카페 회원이야.
아래 게시글에 ${config.reply_style} 댓글을 달아줘.

게시글: "${params.postTitle}"

규칙:
- 서비스명(연운, 퀴즈오아시스, 파나나 등) 직접 언급 금지
- ${serviceHint}
- 2~3문장, 구어체, 이모지 1~2개
- 광고처럼 보이면 안 됨

댓글만 출력.`,
  });

  return raw?.trim() || '저도 비슷한 고민 있었어요. 공감돼요 🙏';
}

export async function generateSelfQuestion(params: {
  productName: string;
  persona?: Partial<AccountPersona> & { gender?: string; occupation?: string };
}): Promise<{ title: string; content: string }> {
  const topic = PRODUCT_TOPIC_MAP[params.productName] || '사주·운세 고민';
  const emotionAngles = ['불안·걱정형', '호기심·궁금증형', '경험공유형', '결정장애형', '위로구함형'];
  const emotion = emotionAngles[Math.floor(Math.random() * emotionAngles.length)];
  const age = params.persona?.age ?? 30;
  const gender = params.persona?.gender ?? '여성';
  const occupation = params.persona?.occupation ?? params.persona?.job ?? '직장인';

  const raw = await askClaudeWithModel({
    model: (await getSubClaudeModel()) || 'claude-haiku-4-5-20251001',
    max_tokens: 400,
    prompt: `너는 ${age}세 ${gender} 네이버 카페 일반 회원 (${occupation}).
주제 "${topic}"으로 자연스러운 고민·질문 게시글을 써줘.
감정 각도: ${emotion}

규칙: 서비스명·앱 추천 금지, 제목 15자 이내, 본문 3~5문장 구어체
JSON만: {"title":"...","content":"..."}`,
  });

  if (raw) {
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      return JSON.parse(jsonMatch?.[0] ?? raw) as { title: string; content: string };
    } catch {
      /* fallback */
    }
  }

  return {
    title: '요즘 고민이 많아요',
    content: `${topic} 관련해서 고민이 있는데 비슷한 경험 있으신 분 계신가요? 조언 부탁드려요 🙏`,
  };
}

async function resolveCafeClubId(page: Page, slug: string): Promise<string | null> {
  await page.goto(`https://cafe.naver.com/${slug}`, { waitUntil: 'domcontentloaded' });
  await sleep(randomBetween(1500, 3000));

  const clubId = await page
    .evaluate(() => {
      const w = window as unknown as { g_sClubId?: string };
      if (w.g_sClubId && /^\d+$/.test(w.g_sClubId)) return w.g_sClubId;

      const iframe = document.querySelector('#cafe_main') as HTMLIFrameElement | null;
      if (iframe?.src) {
        const m = iframe.src.match(/clubid=(\d+)/i);
        if (m) return m[1];
      }

      const html = document.documentElement.innerHTML;
      const patterns = [
        /g_sClubId\s*=\s*['"](\d+)['"]/,
        /"clubId"\s*:\s*(\d+)/,
        /clubid[=:]["']?(\d{5,})/i,
      ];
      for (const re of patterns) {
        const m = html.match(re);
        if (m) return m[1];
      }
      return null;
    })
    .catch(() => null);

  return clubId;
}

async function collectArticleLinks(page: Page): Promise<Array<{ title: string; url: string }>> {
  const frame = page.frame({ name: 'cafe_main' });
  const target = frame ?? page;

  return target
    .$$eval('a.article, .article-board .td_article a, .board-list a', (els) =>
      els
        .map((el) => ({
          title: (el as HTMLElement).textContent?.trim() ?? '',
          url: (el as HTMLAnchorElement).href ?? '',
        }))
        .filter((x) => x.url.includes('articles') && x.title),
    )
    .catch(() => [] as Array<{ title: string; url: string }>);
}

async function searchCafeByKeyword(
  page: Page,
  slug: string,
  clubId: string,
  keyword: string,
): Promise<Array<{ title: string; url: string }>> {
  const searchUrl = `https://cafe.naver.com/ArticleSearchList.nhn?search.query=${encodeURIComponent(keyword)}&search.clubid=${clubId}`;
  await page.goto(searchUrl, { waitUntil: 'domcontentloaded' });
  await sleep(randomBetween(2000, 4000));
  return collectArticleLinks(page);
}

async function searchCafeBoardByKeyword(
  page: Page,
  slug: string,
  keyword: string,
): Promise<Array<{ title: string; url: string }>> {
  await page.goto(`https://cafe.naver.com/${slug}`, { waitUntil: 'domcontentloaded' });
  await sleep(randomBetween(2000, 4000));
  const items = await collectArticleLinks(page);
  const lower = keyword.toLowerCase();
  return items.filter((item) => item.title.toLowerCase().includes(lower));
}

/** 키워드 검색으로 타 카페 게시글 수집 */
export async function scanCafeForTargets(params: {
  cafeSlug: string;
  cafeUuid: string;
  workspace: string;
  keywords: string[];
  page: Page;
}): Promise<CafePostHit[]> {
  const config = await getCafeViralConfig();
  const hits: CafePostHit[] = [];
  const seen = new Set<string>();

  const clubId = await resolveCafeClubId(params.page, params.cafeSlug);

  for (const keyword of params.keywords) {
    try {
      const items = clubId
        ? await searchCafeByKeyword(params.page, params.cafeSlug, clubId, keyword)
        : await searchCafeBoardByKeyword(params.page, params.cafeSlug, keyword);

      const filtered = items.length
        ? items
        : await searchCafeBoardByKeyword(params.page, params.cafeSlug, keyword);

      for (const item of filtered.slice(0, 15)) {
        const url = normalizeCafePostUrl(item.url);
        if (seen.has(url)) continue;
        seen.add(url);
        hits.push({ title: item.title, url, keyword });
      }
    } catch {
      continue;
    }
  }

  for (const hit of hits) {
    await supabase.from('huma_cafe_viral_posts').upsert(
      {
        cafe_id: params.cafeUuid,
        workspace: params.workspace,
        post_url: hit.url,
        post_title: hit.title,
        keyword_matched: hit.keyword ? [hit.keyword] : [],
        status: 'pending',
      },
      { onConflict: 'post_url', ignoreDuplicates: true },
    );
  }

  return hits.slice(0, config.daily_limit_total);
}

export async function postViralReply(params: {
  page: Page;
  postUrl: string;
  reply: string;
}): Promise<void> {
  const humanEngine = await getHumanEngineConfig();
  await writeCafeReply({
    page: params.page,
    postUrl: normalizeCafePostUrl(params.postUrl),
    replyContent: params.reply,
    humanEngine,
  });
}

export async function scanCafeById(cafeId: string, page: Page): Promise<number> {
  const { data: cafe } = await supabase.from('huma_cafe_viral_cafes').select('*').eq('id', cafeId).single();
  if (!cafe?.is_active) throw new Error('비활성 카페');

  const config = await getCafeViralConfig();
  if (!config.enabled) throw new Error('카페 바이럴 비활성');

  const keywords =
    cafe.keywords?.length > 0 ? cafe.keywords : keywordsForWorkspace(config, cafe.workspace);
  const slug = String(cafe.cafe_url).replace(/^https?:\/\/cafe\.naver\.com\//, '').split('/')[0];

  const hits = await scanCafeForTargets({
    cafeSlug: slug,
    cafeUuid: cafeId,
    workspace: cafe.workspace,
    keywords,
    page,
  });
  return hits.length;
}
