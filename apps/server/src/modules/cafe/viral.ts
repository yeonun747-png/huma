import type { Frame, Page } from 'playwright';
import { askClaudeWithModel } from '../../lib/anthropic-client.js';
import { getSubClaudeModel } from '../../lib/ai-engine.js';
import { withHumanWritingMandate } from '../../lib/ai-human-writing.js';
import { resolveCafeClubId } from '../../lib/cafe-nav.js';
import { supabase } from '../../middleware/auth.js';
import { randomBetween, sleep } from '../../lib/utils.js';
import {
  getCafeViralConfig,
  keywordsForWorkspace,
  normalizeCafePostUrl,
  assertCafeViralYeonunWorkspace,
} from '../../lib/cafe-viral-config.js';
import { writeCafeReply } from '../playwright/naver/cafe.js';
import { getHumanEngineConfig } from '../../lib/settings.js';
import type { AccountPersona } from '../playwright/persona.js';
import { generateCafeComment } from './cafe-comment.js';

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

export const PRODUCT_TOPIC_MAP: Record<string, string> = {
  '그 사람은 지금 무슨 생각': '헤어진 사람 마음 궁금할 때',
  '그 사람과 다시 만날 수 있을까': '재회 가능성 고민',
  '미래 배우자운': '결혼 인연 걱정될 때',
  '나와 그 사람, 궁합보기': '연인·짝사랑 궁합 고민',
  '재물보감': '재테크·이직 타이밍 고민',
  '커리어 사주 · 이직 · 승진': '취업·이직·승진 고민',
  '아이 이름 작명': '출산 준비·작명 고민',
  '어젯밤 꿈, 무엇을 말하나': '꿈 해몽 궁금증',
  '자녀와 부모의 궁합': '부모자식 궁합 고민',
  '2026 신년운세': '올해 운세 막막할 때',
  '초년·장년·중년·말년 통합본': '인생 흐름·평생 운세 고민',
  '자미두수 명반 풀이': '자미두수 궁금증',
  '정통 사주풀이 종합': '사주 정밀 풀이 고민',
};

const SEASON_MAP: Record<number, string> = {
  1: '새해·신년운세 시즌',
  2: '밸런타인·연애 시즌',
  3: '봄·새출발 시즌',
  4: '취업·이직 시즌',
  5: '가정의달',
  6: '여름·연애 시즌',
  7: '여름 휴가',
  8: '말복·가을 준비',
  9: '추석·명절',
  10: '취업·이직 시즌',
  11: '연말 결산',
  12: '연말·새해 준비',
};

export function pickRandomProductTopic(): string {
  const keys = Object.keys(PRODUCT_TOPIC_MAP);
  return keys[Math.floor(Math.random() * keys.length)] ?? '정통 사주풀이 종합';
}

/** @deprecated generateCafeComment({ style: 'viral' }) 직접 사용 권장 */
export async function generateViralReply(params: {
  postTitle: string;
  postExcerpt?: string;
  workspace: string;
  persona?: Partial<AccountPersona> & { gender?: string; occupation?: string };
}): Promise<string> {
  return generateCafeComment({
    title: params.postTitle,
    excerpt: params.postExcerpt,
    workspace: params.workspace,
    style: 'viral',
    persona: params.persona,
  });
}

export async function generateGreetingPost(params: {
  persona?: Partial<AccountPersona> & { gender?: string; occupation?: string };
  cafeName?: string;
}): Promise<{ title: string; content: string }> {
  const age = params.persona?.age ?? 32;
  const gender = params.persona?.gender ?? '여성';
  const job = params.persona?.occupation ?? params.persona?.job ?? '직장인';
  const cafeName = params.cafeName ?? '카페';

  const prompt = withHumanWritingMandate(`너는 ${age}세 ${gender} ${job} 네이버 카페 신규 회원이야.
"${cafeName}" 카페 가입인사 게시글을 써줘.

규칙:
- 서비스·앱·사이트 언급 절대 금지
- 광고·홍보처럼 보이면 안 됨
- 자연스러운 일상 소개 + 카페 활동 의사
- 제목 10자 이내, 본문 2~4문장 구어체, 이모지 0~1개
- JSON만: {"title":"...","content":"..."}`);

  const model = (await getSubClaudeModel()) || 'claude-haiku-4-5-20251001';
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await askClaudeWithModel({
      model,
      max_tokens: 300,
      prompt: attempt === 1 ? `${prompt}\n\n(다시 한 번, 더 자연스럽게)` : prompt,
    });
    if (raw) {
      try {
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        const parsed = JSON.parse(jsonMatch?.[0] ?? raw) as { title: string; content: string };
        if (parsed.title && parsed.content) return parsed;
      } catch {
        /* retry */
      }
    }
  }

  throw new Error('가입인사 AI 생성 실패');
}

export async function generateSelfQuestion(params: {
  productName: string;
  persona?: Partial<AccountPersona> & { gender?: string; occupation?: string };
}): Promise<{ title: string; content: string }> {
  const topic = PRODUCT_TOPIC_MAP[params.productName] || '사주·운세 고민';
  const emotionAngles = ['불안·걱정형', '호기심·궁금증형', '경험공유형', '결정장애형', '위로구함형'];
  const emotion = emotionAngles[Math.floor(Math.random() * emotionAngles.length)];
  const season = SEASON_MAP[new Date().getMonth() + 1] || '일상';
  const age = params.persona?.age ?? 30;
  const gender = params.persona?.gender ?? '여성';
  const occupation = params.persona?.occupation ?? params.persona?.job ?? '직장인';

  const model = (await getSubClaudeModel()) || 'claude-haiku-4-5-20251001';
  const basePrompt = withHumanWritingMandate(`너는 ${age}세 ${gender} 네이버 카페 일반 회원 (${occupation}).
주제 "${topic}"으로 자연스러운 고민·질문 게시글을 써줘.

이번 글의 감정 각도: ${emotion}
현재 시즌 맥락: ${season}
페르소나 직업: ${occupation}

규칙:
- 서비스명(연운, 퀴즈오아시스, 파나나 등) 절대 언급 금지
- 앱·사이트 직접 추천 금지
- 감정 각도(${emotion})에 맞는 말투로 작성
- 시즌 맥락(${season})을 자연스럽게 녹이기 (억지스러우면 무시)
- 마지막에 댓글 유도 ("경험 있으신 분?", "어떻게 하셨나요?" 등)
- 제목 15자 이내, 본문 3~5문장 구어체, 이모지 자연스럽게
- 같은 주제라도 매번 다른 시각·말투로 작성

JSON만 출력: {"title":"...","content":"..."}`);

  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await askClaudeWithModel({
      model,
      max_tokens: 400,
      prompt: attempt === 1 ? `${basePrompt}\n\n(다시 한 번, 더 자연스럽게)` : basePrompt,
    });
    if (raw) {
      try {
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        const parsed = JSON.parse(jsonMatch?.[0] ?? raw) as { title: string; content: string };
        if (parsed.title && parsed.content) return parsed;
      } catch {
        /* retry */
      }
    }
  }

  throw new Error(`자문자답 질문 AI 생성 실패: ${topic}`);
}

async function waitForCafeMainFrame(page: Page): Promise<Frame | null> {
  await page.waitForSelector('#cafe_main', { timeout: 15000 }).catch(() => {});
  await sleep(randomBetween(1500, 2500));
  const frame = page.frame({ name: 'cafe_main' });
  if (frame) {
    await frame.waitForLoadState('domcontentloaded').catch(() => {});
    await sleep(randomBetween(1000, 2000));
  }
  return frame;
}

async function readPageText(page: Page, frame: Frame | null): Promise<string> {
  const chunks: string[] = [];
  if (frame) {
    chunks.push(await frame.locator('body').innerText().catch(() => ''));
  }
  chunks.push(await page.locator('body').innerText().catch(() => ''));
  return chunks.join('\n');
}

export async function assertCafeBrowseAccess(page: Page): Promise<void> {
  const frame = await waitForCafeMainFrame(page);
  const text = await readPageText(page, frame);
  if (
    text.includes('회원만 가입') ||
    text.includes('회원만') && text.includes('가입') ||
    text.includes('로그인해주세요') ||
    text.includes('실명 확인 회원만')
  ) {
    throw new Error(
      '비공개 카페 — 네이버 로그인·카페 가입된 계정으로 스캔해야 합니다. 계정관리에서 계정을 등록하고 럭키포에버에 가입하세요.',
    );
  }
}

function isArticleUrl(url: string): boolean {
  return /ArticleRead|\/articles\/\d+/i.test(url);
}

function cleanArticleTitle(raw: string): string {
  return raw.replace(/\s*\[\d+\]\s*$/, '').trim();
}

async function collectArticleLinks(target: Page | Frame): Promise<Array<{ title: string; url: string }>> {
  return target
    .$$eval(
      'a.article, a[href*="ArticleRead"], a[href*="/articles/"], .article-board .td_article a, .inner_list a, .board-list a, .article-table a',
      (els) => {
        const seen = new Set<string>();
        const out: Array<{ title: string; url: string }> = [];
        for (const el of els) {
          const a = el as HTMLAnchorElement;
          const url = a.href ?? '';
          const title = (a.textContent ?? '').replace(/\s*\[\d+\]\s*$/, '').trim();
          if (!title || title.length < 2) continue;
          if (!/ArticleRead|\/articles\/\d+/i.test(url)) continue;
          if (seen.has(url)) continue;
          seen.add(url);
          out.push({ title, url });
        }
        return out;
      },
    )
    .catch(() => [] as Array<{ title: string; url: string }>);
}

async function openCafeArticleList(page: Page, slug: string, clubId: string | null): Promise<Frame | null> {
  if (clubId) {
    await page.goto(`https://cafe.naver.com/ArticleList.nhn?search.clubid=${clubId}`, {
      waitUntil: 'domcontentloaded',
    });
  } else {
    await page.goto(`https://cafe.naver.com/${slug}`, { waitUntil: 'domcontentloaded' });
  }
  await sleep(randomBetween(2000, 4000));
  return waitForCafeMainFrame(page);
}

async function searchCafeByKeyword(
  page: Page,
  clubId: string,
  keyword: string,
): Promise<Array<{ title: string; url: string }>> {
  const searchUrl = `https://cafe.naver.com/ArticleSearchList.nhn?search.query=${encodeURIComponent(keyword)}&search.clubid=${clubId}&search.searchBy=0`;
  await page.goto(searchUrl, { waitUntil: 'domcontentloaded' });
  await sleep(randomBetween(2000, 4000));
  const frame = await waitForCafeMainFrame(page);
  return collectArticleLinks(frame ?? page);
}

function matchKeyword(title: string, keywords: string[]): string | undefined {
  const lower = title.toLowerCase();
  return keywords.find((kw) => lower.includes(kw.trim().toLowerCase()));
}

function mergeHits(
  hits: CafePostHit[],
  seen: Set<string>,
  items: Array<{ title: string; url: string }>,
  keywords: string[],
  keywordHint?: string,
): void {
  for (const item of items) {
    const title = cleanArticleTitle(item.title);
    const matched = keywordHint ?? matchKeyword(title, keywords);
    if (!matched) continue;
    const url = normalizeCafePostUrl(item.url);
    if (!isArticleUrl(url) || seen.has(url)) continue;
    seen.add(url);
    hits.push({ title, url, keyword: matched });
  }
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
  const keywords = params.keywords.map((k) => k.trim()).filter(Boolean);
  if (!keywords.length) return hits;

  const clubId = await resolveCafeClubId(params.page, params.cafeSlug);
  const frame = await openCafeArticleList(params.page, params.cafeSlug, clubId);
  await assertCafeBrowseAccess(params.page);

  const boardItems = await collectArticleLinks(frame ?? params.page);
  mergeHits(hits, seen, boardItems, keywords);

  if (clubId) {
    for (const keyword of keywords) {
      try {
        const searched = await searchCafeByKeyword(params.page, clubId, keyword);
        mergeHits(hits, seen, searched, keywords, keyword);
      } catch {
        continue;
      }
    }
  }

  if (!hits.length && boardItems.length) {
    throw new Error(
      `게시글 ${boardItems.length}건은 확인했지만 키워드(${keywords.join(', ')})와 일치하는 글이 없습니다. 키워드를 수정해 보세요.`,
    );
  }

  if (!hits.length && !boardItems.length) {
    throw new Error(
      '카페 게시판을 불러오지 못했습니다. 계정이 카페 회원인지, 등급·가입 상태를 확인하세요.',
    );
  }

  for (const hit of hits.slice(0, config.daily_limit_total)) {
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
  assertCafeViralYeonunWorkspace(String(cafe.workspace));

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
