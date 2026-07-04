import { askClaudeWithModel } from '../../lib/anthropic-client.js';
import { getMainClaudeModel, getSubClaudeModel } from '../../lib/ai-engine.js';
import {
  withHumanWritingMandate,
  withHumanWritingSystem,
  withLongformWritingMandate,
} from '../../lib/ai-human-writing.js';
import { formatKstWritingContext, buildKstDaypartWritingGuide } from '../../lib/dashboard-period.js';
import { buildYeonunContextWithPrompt } from '../content/yeonun-context.js';
import { buildQuizOasisContextWithPrompt } from '../content/quizoasis-context.js';
import { buildPananaContextWithPrompt } from '../content/panana-context.js';
import {
  defaultWorkspaceHashtags,
  sanitizeHashtags,
  urlContextForHashtags,
} from '../../lib/hashtag-sanitize.js';
import {
  blogPostLengthPromptGuide,
  pickBlogPostLengthRange,
  type BlogPostLengthRange,
  type BlogPostLengthTier,
} from '../../lib/blog-post-length.js';
import {
  normalizeServiceMentionsInPost,
  resolveWorkspaceServiceMention,
  workspaceServiceMentionPromptGuide,
  workspaceServiceMentionRuleLine,
} from '../../lib/workspace-service-mention.js';
import {
  buildPostingBodySimilarityFeedback,
  buildPostingTitleSimilarityFeedback,
  checkPostingSimilarity,
  isPostingSimilarityTooHigh,
  loadPostingSimilarityCorpus,
  maxPostingTitleSimilarity,
  MAX_POSTING_BODY_SIMILARITY_RETRIES,
  MAX_POSTING_TITLE_SIMILARITY_ATTEMPTS,
  POSTING_TITLE_HEURISTIC_FALLBACK_AFTER,
  PostingSimilarityCorpusLoadError,
  PostingSimilaritySkipError,
  POSTING_SIMILARITY_THRESHOLD,
} from '../../lib/posting-content-similarity.js';
import { postingSlotByWorkspace } from '../../lib/dongle-slots.js';
import { withPostingSimilarityLock } from '../../lib/posting-similarity-lock.js';
import { logOperation } from '../../lib/log-emitter.js';
import {
  isPureKoreanSeoTitle,
  sanitizeKoreanSeoTitle,
  truncateKoreanSeoTitle,
} from '../../lib/seo-title-korean.js';

export interface ContentGenerationInput {
  title: string;
  sourceUrl: string;
  synopsis?: string;
  workspace: string;
  content_type?: 'A' | 'B';
  /** 계정별 블로그 문체 지침 (연운 ~요체 등) */
  blogWritingPersona?: string;
}

export interface ContentGenerationOutput {
  blog_post: string;
  /** 네이버 검색 최적화 제목 (≤32자, 핵심 키워드 앞배치). 항상 SEO 변환됨 */
  seo_title: string;
  tiktok_caption: string;
  instagram_caption: string;
  threads_text: string;
  x_text: string;
  image_prompt: string;
  video_prompt: string;
  /** v3.26: 비우면 Kling 3.0 내장 오디오 (TTS 미사용) */
  tts_script?: string;
  hashtags: string[];
  /** 이번 생성 목표 분량 tier (700|800|1000) */
  blog_post_target_chars?: BlogPostLengthTier;
  blog_post_target_min_chars?: number;
  blog_post_target_max_chars?: number;
  /** post_blog 유사도 검사 — 최종 본문 max 유사도 */
  similarity_score?: number;
  /** 유사도 초과로 Claude 재생성한 횟수 */
  similarity_regenerations?: number;
}

export interface GenerateAllContentOptions {
  /** 포스팅 계정 — 설정 시 과거 발행 대비 유사도 가드 */
  accountId?: string;
  /** Claude main 재생성 시 추가 지시 */
  mainExtraPrompt?: string;
}

const SONNET_MODEL_FALLBACK = 'claude-sonnet-4-6';
const HAIKU_MODEL_FALLBACK = 'claude-haiku-4-5-20251001';

const SYSTEM_PROMPTS: Record<string, string> = {
  yeonun: `당신은 연운(緣運) 네이버 블로그에 글을 쓰는 30대 한국인 독자입니다. 마케터·AI가 아닙니다.
톤: ~요체, 가볍고 친근, 친구에게 카톡하듯. 경험담·솔직한 감정·짧은 추임새(ㅎㅎ, ㅠㅠ)를 적절히.
금지: AI/마케팅 문체 — 「정리했습니다」「안내합니다」「살펴보겠습니다」「흐름과 실천 포인트를 정리」 같은 표현.
필수: 입력에 [말투]·[캐릭터 포스팅 톤 지침]·character_mode_prompts가 있으면 그 말투를 본문에 그대로 반영.
${workspaceServiceMentionRuleLine('yeonun')}`,
  quizoasis: `당신은 퀴즈오아시스 글로벌 심리테스트 플랫폼의 콘텐츠 마케터입니다.
톤: 재미있고 공유 욕구를 자극하는 가벼운 문체.
필수: 입력에 [퀴즈오아시스 테스트] 블록(계정관리 퀴즈 캐시)이 있으면 제목·소개·slug를 글 주제로 반영.
${workspaceServiceMentionRuleLine('quizoasis')}`,
  panana: `당신은 파나나(PANANA) AI 캐릭터 콘텐츠 플랫폼의 콘텐츠 마케터입니다.
톤: 시네마틱하고 감성적인 짧은 문체.
필수: 입력에 [파나나 캐릭터] 블록(계정관리 캐릭터 캐시)이 있으면 이름·소개·톤을 글에 반영.
${workspaceServiceMentionRuleLine('panana')}`,
};

function finalizeBlogPost(text: string, workspace: string): string {
  return normalizeServiceMentionsInPost(text.trim(), workspace);
}

const SEO_TITLE_MAX = 32;

function normalizeTitleCompare(s: string): string {
  return s.trim().replace(/\s+/g, ' ').toLowerCase();
}

function truncateSeoTitle(s: string): string {
  return truncateKoreanSeoTitle(s);
}

function isAcceptableSeoTitle(seo: string | undefined, operatorTitle: string): boolean {
  const t = seo?.trim();
  if (!t) return false;
  if (t.length > SEO_TITLE_MAX) return false;
  if (!isPureKoreanSeoTitle(t)) return false;
  if (normalizeTitleCompare(t) === normalizeTitleCompare(operatorTitle)) return false;
  return true;
}

function finalizeSeoTitleCandidate(raw: string): string {
  return sanitizeKoreanSeoTitle(raw);
}

function heuristicSeoTitle(operatorTitle: string, synopsis?: string, blogExcerpt?: string): string {
  const synopsisTrim = synopsis?.trim();
  const keywords = operatorTitle
    .trim()
    .split(/[\s·—\-,]+/)
    .filter((w) => w.length >= 2);
  const prefix = keywords.slice(0, 2).join(' ');

  if (synopsisTrim) {
    const body = synopsisTrim.replace(/\s+/g, ' ');
    if (prefix && !body.includes(prefix.slice(0, Math.min(4, prefix.length)))) {
      return truncateSeoTitle(`${prefix} ${body}`.trim());
    }
    return truncateSeoTitle(body);
  }

  const excerpt = blogExcerpt?.trim().replace(/\s+/g, ' ');
  if (excerpt) {
    const lead = excerpt.split(/[.!?]\s/)[0]?.trim() ?? excerpt;
    if (prefix && !lead.includes(prefix.slice(0, Math.min(4, prefix.length)))) {
      return truncateSeoTitle(`${prefix} ${lead}`.trim());
    }
    return truncateSeoTitle(lead);
  }

  if (prefix) return truncateSeoTitle(`${prefix} 총정리`);
  return truncateSeoTitle(operatorTitle.trim());
}

function forceDistinctSeoTitle(operatorTitle: string, synopsis?: string, blogExcerpt?: string): string {
  const base = heuristicSeoTitle(operatorTitle, synopsis, blogExcerpt);
  if (normalizeTitleCompare(base) !== normalizeTitleCompare(operatorTitle)) return base;

  const variants = [
    `${operatorTitle.slice(0, 20)} 총정리`,
    `${operatorTitle.slice(0, 18)} 후기`,
    `${operatorTitle.slice(0, 16)} 추천`,
  ];
  for (const v of variants) {
    const t = truncateSeoTitle(v);
    if (normalizeTitleCompare(t) !== normalizeTitleCompare(operatorTitle)) return t;
  }
  return truncateSeoTitle(`${operatorTitle.slice(0, 28)} 정리`);
}

/** SEO 제목 유사도 루프 — LLM 재시도 상한 후 빠른 휴리스틱 변형 */
function pickSeoTitleHeuristicFallback(
  operatorTitle: string,
  synopsis: string | undefined,
  blogExcerpt: string,
  attempt: number,
): string {
  const variants = [
    forceDistinctSeoTitle(operatorTitle, synopsis, blogExcerpt),
    truncateSeoTitle(`${operatorTitle.slice(0, 20)} 총정리`),
    truncateSeoTitle(`${operatorTitle.slice(0, 18)} 후기`),
    truncateSeoTitle(`${operatorTitle.slice(0, 16)} 추천`),
    truncateSeoTitle(`${operatorTitle.slice(0, 22)} 정리`),
    truncateSeoTitle(`${operatorTitle.slice(0, 14)} 솔직후기`),
    truncateSeoTitle(`${operatorTitle.slice(0, 12)} 써봤어요`),
    truncateSeoTitle(`${operatorTitle.slice(0, 10)} 사용기`),
  ];
  const picked = variants[(attempt - 1) % variants.length] ?? variants[0]!;
  return finalizeSeoTitleCandidate(picked);
}

async function generateSeoTitleOnly(params: {
  operatorTitle: string;
  synopsis?: string;
  urlSummary: string;
  blogExcerpt?: string;
  extraPrompt?: string;
}): Promise<string | undefined> {
  const synopsisBlock = params.synopsis?.trim()
    ? `[운영자 시놉시스 — 반드시 반영]\n${params.synopsis.trim()}`
    : '[시놉시스 없음]';

  const similarityBlock = params.extraPrompt?.trim()
    ? `\n[유사도 재생성 지침 — 반드시 따를 것]\n${params.extraPrompt.trim()}`
    : '';

  const raw = await askClaudeWithModel({
    model: (await getSubClaudeModel()) || HAIKU_MODEL_FALLBACK,
    max_tokens: 120,
    prompt: `네이버 블로그 검색 노출용 SEO 제목만 생성 (JSON만).

운영자 입력 제목(참고용·그대로 쓰지 말 것): ${params.operatorTitle}
${synopsisBlock}
[URL·주제 요약]
${params.urlSummary.slice(0, 400)}
${params.blogExcerpt ? `[생성된 본문 앞부분]\n${params.blogExcerpt.slice(0, 300)}` : ''}
${similarityBlock}

규칙:
- 32자 이내 (공백 포함, 초과 금지)
- 한글·숫자·공백만 (|, ·, -, 영문, 특수문자 금지)
- 핵심 검색 키워드를 앞쪽 배치
- 운영자 제목과 동일·거의 동일하게 쓰지 말 것
- 과장·특수문자·영문 금지
- 클릭 유도 자연스러운 한국어

{"seo_title":"..."}`,
  });

  if (!raw) return undefined;
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch?.[0] ?? raw) as { seo_title?: string };
    return parsed.seo_title?.trim();
  } catch {
    return undefined;
  }
}

/** SEO 제목 강제 — 운영자 제목 그대로 사용 금지 */
export async function ensureSeoTitle(params: {
  operatorTitle: string;
  synopsis?: string;
  urlSummary: string;
  blogExcerpt?: string;
  candidate?: string;
  extraPrompt?: string;
}): Promise<string> {
  const operatorTitle = params.operatorTitle.trim();
  if (isAcceptableSeoTitle(params.candidate, operatorTitle)) {
    return finalizeSeoTitleCandidate(params.candidate!.trim());
  }

  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const generated = await generateSeoTitleOnly(params);
      if (isAcceptableSeoTitle(generated, operatorTitle)) {
        return finalizeSeoTitleCandidate(generated!.trim());
      }
    } catch (err) {
      console.warn('[content-generator] seo_title 전용 생성 실패:', (err as Error).message);
    }
  }

  return finalizeSeoTitleCandidate(forceDistinctSeoTitle(operatorTitle, params.synopsis, params.blogExcerpt));
}

/** 유사도 루프 전용 — forceDistinct 폴백 없이 LLM 재시도만 */
async function regenerateSeoTitleForSimilarity(params: {
  operatorTitle: string;
  synopsis?: string;
  urlSummary: string;
  blogExcerpt: string;
  extraPrompt: string;
}): Promise<string> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const candidate = await generateSeoTitleOnly({
      operatorTitle: params.operatorTitle,
      synopsis: params.synopsis,
      urlSummary: params.urlSummary,
      blogExcerpt: params.blogExcerpt,
      extraPrompt: params.extraPrompt,
    });
    if (candidate?.trim() && isAcceptableSeoTitle(candidate, params.operatorTitle)) {
      return finalizeSeoTitleCandidate(candidate.trim());
    }
  }
  throw new Error('SEO 제목 유사도 재생성 실패');
}

export function resolvePostingTitle(generated: Pick<ContentGenerationOutput, 'seo_title'>): string {
  return finalizeSeoTitleCandidate(generated.seo_title.trim());
}

async function fetchUrlText(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; HUMA/1.0)' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return '';
    const html = await res.text();
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 8000);
  } catch {
    return '';
  }
}

/** @internal exported for autoDecide Step 0 */
export async function fetchAndSummarizeUrl(url: string): Promise<string> {
  const rawText = await fetchUrlText(url);
  if (!rawText) return `URL: ${url}`;

  const summary = await askClaudeWithModel({
    model: (await getSubClaudeModel()) || HAIKU_MODEL_FALLBACK,
    max_tokens: 500,
    prompt: `다음 웹페이지 내용의 핵심을 500자 이내로 요약. 서비스 특징·기능 중심:\n\n${rawText}`,
  });
  return summary ?? rawText.slice(0, 500);
}

function fallbackContent(
  input: ContentGenerationInput,
  urlSummary: string,
  lengthRange: BlogPostLengthRange,
): ContentGenerationOutput {
  const intro = input.synopsis?.trim() || input.title.trim();
  const summaryLen = lengthRange.max <= 700 ? 220 : lengthRange.max <= 800 ? 320 : 400;
  const body = finalizeBlogPost(
    [
      intro,
      '',
      urlSummary.slice(0, summaryLen),
      '',
      `${resolveWorkspaceServiceMention(input.workspace).nameOnly}에서 확인`,
    ].join('\n'),
    input.workspace,
  );
  const short = `${input.title}. ${(input.synopsis ?? urlSummary).slice(0, 80).trim()}`;
  const wsTag = input.workspace === 'quizoasis' ? '#심리테스트' : input.workspace === 'panana' ? '#AI캐릭터' : '#사주';
  return {
    blog_post: body,
    seo_title: finalizeSeoTitleCandidate(forceDistinctSeoTitle(input.title, input.synopsis, body)),
    blog_post_target_chars: lengthRange.tier,
    blog_post_target_min_chars: lengthRange.min,
    blog_post_target_max_chars: lengthRange.max,
    tiktok_caption: short.slice(0, 150),
    instagram_caption: short.slice(0, 300),
    threads_text: `${short}\n\n${input.sourceUrl}`,
    x_text: `${short.slice(0, 220)} ${input.sourceUrl}`.slice(0, 280),
    image_prompt: `Cinematic vertical 9:16 image about ${input.title}, moody lighting, high detail`,
    video_prompt: `Cinematic 9:16 vertical video about ${input.title}, smooth camera motion`,
    hashtags: sanitizeHashtags([wsTag.replace(/^#/, ''), 'AI', '콘텐츠'], input.workspace),
  };
}

async function generateMainContent(
  input: ContentGenerationInput,
  urlSummary: string,
  lengthRange: BlogPostLengthRange,
  mainExtraPrompt?: string,
): Promise<Omit<ContentGenerationOutput, 'hashtags'>> {
  const lengthGuide = blogPostLengthPromptGuide(lengthRange);
  const { min, max } = lengthRange;
  const writingNow = formatKstWritingContext();
  const daypartGuide = buildKstDaypartWritingGuide();
  const sourceUrl = input.sourceUrl?.trim() || '(없음)';
  const synopsisGuide = input.synopsis
    ? `\n[운영자 시놉시스 - 반드시 참고]\n"${input.synopsis}"`
    : '\n[시놉시스 없음 — 아래 참조 URL·URL 요약을 반드시 반영해 작성]';

  const datetimeGuide = `\n[현재 시각 — 글은 이 순간 KST에 실제 발행되는 것처럼 작성]
${writingNow}
${daypartGuide}
「지금·오늘·이번 달」 관점. 발행 KST 시각과 어긋난 시간대를 「지금 일어난 일」처럼 쓰지 말 것 (예: 오전 발행인데 저녁 요리, 점심이 아닌데 점심 식사 회상). 날짜·시각을 본문에 그대로 밝힐 필요 없음.`;

  const typeGuide =
    input.content_type === 'A'
      ? '\n콘텐츠 타입 A: 텍스트+이미지 중심. video_prompt는 짧게.'
      : '\n콘텐츠 타입 B: 텍스트+이미지+영상. video_prompt를 풍부하게. 오디오는 Kling 3.0 내장 — tts_script 필드 생략.';

  const personaGuide = input.blogWritingPersona?.trim()
    ? `\n[계정 블로그 문체 — 반드시 준수]\n${input.blogWritingPersona.trim()}`
    : input.workspace === 'yeonun'
      ? '\n[블로그 문체] ~요체·경험담·AI 티 금지. speech_style·캐릭터 톤 지침을 본문 말투에 반영.'
      : '';

  const serviceMentionGuide = workspaceServiceMentionPromptGuide(input.workspace);

  const userParts: Array<Record<string, unknown>> = [
    {
      type: 'text',
      text: withLongformWritingMandate(`[참조 URL — 반드시 내용에 반영] ${sourceUrl}

${urlSummary}
${datetimeGuide}

제목: ${input.title}${synopsisGuide}${personaGuide}${typeGuide}
${lengthGuide}

[서비스 언급 규칙]
${serviceMentionGuide}

순수 JSON만 (코드블록 없이):
{
  "seo_title": "네이버 검색 최적화 제목 32자 이내. 한글·숫자·공백만. 핵심 키워드 앞배치",
  "blog_post": "네이버 블로그 글 ${min}~${max}자 (필수·중간 끊김 금지·완결된 글). ${serviceMentionGuide.replace(/\n/g, ' ')}",
  "tiktok_caption": "TikTok 캡션 150자 이내",
  "instagram_caption": "Instagram 캡션 300자 이내",
  "threads_text": "Threads 텍스트 500자 이내, 링크 포함",
  "x_text": "X 텍스트 280자 이내, 링크 포함",
  "image_prompt": "Imagen 4 영문. still life·상징 오브젝트만 — 사람·얼굴·손·상반신·실루엣·인체 일부 절대 금지. 돈→coins/gold, 사랑→hearts/cherry blossom, 직장→office symbols. 텍스트·로고 없음. 9:16 cinematic",
  "video_prompt": "Kling 3.0 9:16 영상 프롬프트 (영문, 내장 오디오)"
}`),
    },
  ];

  const model = (await getMainClaudeModel()) || SONNET_MODEL_FALLBACK;
  const system = withHumanWritingSystem(SYSTEM_PROMPTS[input.workspace] ?? SYSTEM_PROMPTS.yeonun);

  const callOnce = async (extra?: string) => {
    const mergedExtra = [mainExtraPrompt, extra].filter(Boolean).join('\n\n');
    const content = mergedExtra
      ? [...userParts, { type: 'text', text: mergedExtra }]
      : userParts;
    const raw = await askClaudeWithModel({ model, max_tokens: 4096, system, content });
    if (!raw) throw new Error('Claude Sonnet 응답 없음');
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const out = JSON.parse(jsonMatch?.[0] ?? raw) as Omit<ContentGenerationOutput, 'hashtags'>;
    if (!out.blog_post) throw new Error('블로그 본문 생성 실패');
    out.blog_post = finalizeBlogPost(out.blog_post, input.workspace);
    return out;
  };

  let parsed = await callOnce();

  // 목표 분량 검증 — 허용 범위(min*0.85 ~ max*1.25) 밖이면 1회 보정 재생성.
  const inRange = (len: number) => len >= min * 0.85 && len <= max * 1.25;
  if (!inRange(parsed.blog_post.length)) {
    const cur = parsed.blog_post.length;
    const hint =
      cur < min
        ? `직전 본문이 ${cur}자로 너무 짧습니다. 같은 주제·말투를 유지하되 내용을 자연스럽게 보강해 ${min}~${max}자로 다시 작성해 동일 JSON 형식으로만 출력하세요.`
        : `직전 본문이 ${cur}자로 너무 깁니다. 핵심을 유지하며 군더더기를 줄여 ${min}~${max}자로 다시 작성해 동일 JSON 형식으로만 출력하세요.`;
    try {
      const retry = await callOnce(hint);
      // 목표 범위에 더 가까운 결과 선택
      const dist = (len: number) => (len < min ? min - len : len > max ? len - max : 0);
      if (dist(retry.blog_post.length) < dist(parsed.blog_post.length)) {
        parsed = retry;
      }
    } catch {
      // 재생성 실패 시 1차 결과 유지
    }
  }

  parsed.blog_post_target_chars = lengthRange.tier;
  parsed.blog_post_target_min_chars = lengthRange.min;
  parsed.blog_post_target_max_chars = lengthRange.max;
  return parsed;
}

async function generateSubContent(params: {
  title: string;
  synopsis?: string;
  blogExcerpt: string;
  workspace: string;
  urlSummary: string;
}): Promise<{ hashtags: string[] }> {
  const synopsisBlock = params.synopsis?.trim()
    ? `[운영자 시놉시스 — 최우선]\n${params.synopsis.trim()}`
    : '[시놉시스 없음 — 제목·본문 요약 기준]';
  const urlHint = urlContextForHashtags(params.urlSummary);
  const urlBlock = urlHint ? `\n[참고 URL·상품 정보 — 주제 태그 보조만, 로딩·오류 문구 무시]\n${urlHint}` : '';

  const raw = await askClaudeWithModel({
    model: (await getSubClaudeModel()) || HAIKU_MODEL_FALLBACK,
    max_tokens: 300,
    prompt: `네이버 블로그·SNS용 해시태그 8~15개 (JSON만, # 접두사 없이 태그명만).

서비스: ${params.workspace}
제목: ${params.title}
${synopsisBlock}
[생성된 본문 앞부분 — 주제 파악용]
${params.blogExcerpt.slice(0, 700)}${urlBlock}

규칙:
- 제목·시놉시스·본문 주제 키워드만 (검색·발견에 유리한 한국어)
- URL fetch·로딩·오류·기술 메시지에서 태그 추출 금지
- 절대 금지: 로딩중, 웹페이지오류, 콘텐츠없음, 재로딩필요, error, 404, undefined, 새로고침, 오류발생 등
- 마케팅·AI·콘텐츠 같은 범용 태그만으로 채우지 말 것

{"hashtags":["태그1","태그2"]}`,
  });

  const fallback = defaultWorkspaceHashtags(params.workspace);
  if (!raw) return { hashtags: fallback };

  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch?.[0] ?? raw) as { hashtags?: string[] };
    return {
      hashtags: sanitizeHashtags(parsed.hashtags ?? [], params.workspace),
    };
  } catch {
    return { hashtags: fallback };
  }
}

async function resolveSourceContext(input: ContentGenerationInput): Promise<string> {
  const url = input.sourceUrl?.trim();
  if (!url) {
    return '[참조 URL 없음] 제목만으로는 부족 — 운영자 source_url 확인 필요';
  }

  const blocks: string[] = [`[참조 URL] ${url}`];
  let skipUrlFetch = false;

  if (input.workspace === 'yeonun') {
    const yeonunCtx = await buildYeonunContextWithPrompt(url);
    if (yeonunCtx.trim()) {
      blocks.push(yeonunCtx);
      if (yeonunCtx.includes('[연운 상품 정보]')) skipUrlFetch = true;
    }
  }

  if (input.workspace === 'quizoasis') {
    const quizCtx = await buildQuizOasisContextWithPrompt(url);
    if (quizCtx.text.trim()) {
      blocks.push(quizCtx.text);
      if (quizCtx.cacheHit) skipUrlFetch = true;
    }
  }

  if (input.workspace === 'panana') {
    const pananaCtx = await buildPananaContextWithPrompt(url);
    if (pananaCtx.text.trim()) {
      blocks.push(pananaCtx.text);
      if (pananaCtx.cacheHit) skipUrlFetch = true;
    }
  }

  if (skipUrlFetch) {
    blocks.push('[캐시 컨텍스트 적용 — 계정관리 동기화 데이터 기준, URL fetch 생략]');
  } else {
    const fetched = await fetchAndSummarizeUrl(url);
    if (fetched.trim() && !/^URL:\s*$/i.test(fetched)) {
      blocks.push(
        fetched.startsWith('URL:')
          ? `[URL fetch 실패 — 주소만 참고]\n${fetched}\n(가능하면 워크스페이스 캐시·페이지 구조를 추론)`
          : `[URL 페이지 요약]\n${fetched}`,
      );
    } else if (blocks.length === 1) {
      blocks.push(`[URL fetch 실패] ${url} — 제목·시놉시스·계정관리 캐시 동기화 여부 확인`);
    }
  }

  return blocks.join('\n\n');
}

async function generateAllContentOnce(
  input: ContentGenerationInput,
  options?: Pick<GenerateAllContentOptions, 'mainExtraPrompt'>,
): Promise<ContentGenerationOutput> {
  const urlSummary = await resolveSourceContext(input);
  const lengthRange = pickBlogPostLengthRange();

  const finalize = async (
    partial: Omit<ContentGenerationOutput, 'hashtags' | 'seo_title'> & { seo_title?: string },
    hashtags: string[],
  ): Promise<ContentGenerationOutput> => {
    const seo_title = await ensureSeoTitle({
      operatorTitle: input.title,
      synopsis: input.synopsis,
      urlSummary,
      blogExcerpt: partial.blog_post,
      candidate: partial.seo_title,
    });
    return { ...partial, seo_title, hashtags };
  };

  try {
    const mainContent = await generateMainContent(
      input,
      urlSummary,
      lengthRange,
      options?.mainExtraPrompt,
    );
    const subContent = await generateSubContent({
      title: input.title,
      synopsis: input.synopsis,
      blogExcerpt: mainContent.blog_post,
      workspace: input.workspace,
      urlSummary,
    });
    return finalize(mainContent, subContent.hashtags);
  } catch (mainErr) {
    if (!process.env.ANTHROPIC_API_KEY) {
      return fallbackContent(input, urlSummary, lengthRange);
    }
    try {
      const retryRaw = await askClaudeWithModel({
        model: (await getSubClaudeModel()) || HAIKU_MODEL_FALLBACK,
        max_tokens: 2000,
        system: withHumanWritingSystem(SYSTEM_PROMPTS[input.workspace] ?? SYSTEM_PROMPTS.yeonun),
        prompt: withLongformWritingMandate(
          `${options?.mainExtraPrompt ? `${options.mainExtraPrompt}\n\n` : ''}제목: ${input.title}
${input.synopsis?.trim() ? `[운영자 시놉시스 - 반드시 참고]\n"${input.synopsis.trim()}"` : '[시놉시스 없음 — URL 요약 반영]'}
URL 요약: ${urlSummary.slice(0, 500)}
${blogPostLengthPromptGuide(lengthRange)}

[서비스 언급 규칙]
${workspaceServiceMentionPromptGuide(input.workspace)}

네이버 블로그용 ${lengthRange.min}~${lengthRange.max}자 완결 본문과 SEO 제목·SNS 캡션을 JSON으로 (tts_script 생략, Kling 내장 오디오):
{"seo_title":"한글·숫자·공백만 32자 이내. 핵심 키워드 앞배치, 운영자 제목과 다르게","blog_post":"...","tiktok_caption":"...","instagram_caption":"...","threads_text":"...","x_text":"...","image_prompt":"...","video_prompt":"..."}`,
        ),
      });
      const jsonMatch = retryRaw?.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as Omit<ContentGenerationOutput, 'hashtags'>;
        const sub = await generateSubContent({
          title: input.title,
          synopsis: input.synopsis,
          blogExcerpt: parsed.blog_post,
          workspace: input.workspace,
          urlSummary,
        });
        if (parsed.blog_post) {
          parsed.blog_post = finalizeBlogPost(parsed.blog_post, input.workspace);
          parsed.blog_post_target_chars = lengthRange.tier;
          parsed.blog_post_target_min_chars = lengthRange.min;
          parsed.blog_post_target_max_chars = lengthRange.max;
          return finalize(parsed, sub.hashtags);
        }
      }
    } catch {
      /* fall through */
    }
    console.warn('[content-generator] Sonnet failed, using fallback:', (mainErr as Error).message);
    return fallbackContent(input, urlSummary, lengthRange);
  }
}

/** 기획서 7-0 generateAllContent */
export async function generateAllContent(
  input: ContentGenerationInput,
  options?: GenerateAllContentOptions,
): Promise<ContentGenerationOutput> {
  const requiresSimilarity = Boolean(postingSlotByWorkspace(input.workspace));
  const accountId = options?.accountId?.trim();

  if (requiresSimilarity && !accountId) {
    throw new Error('포스팅 계정 ID가 없어 유사도 검사를 진행할 수 없습니다');
  }

  if (!accountId) {
    return generateAllContentOnce(input, options);
  }

  return withPostingSimilarityLock(accountId, () =>
    generateAllContentWithSimilarity(input, options, accountId),
  );
}

async function generateAllContentWithSimilarity(
  input: ContentGenerationInput,
  options: GenerateAllContentOptions | undefined,
  accountId: string,
): Promise<ContentGenerationOutput> {
  let corpus: Awaited<ReturnType<typeof loadPostingSimilarityCorpus>>;
  try {
    corpus = await loadPostingSimilarityCorpus(accountId);
  } catch (err) {
    if (err instanceof PostingSimilarityCorpusLoadError) {
      throw new PostingSimilaritySkipError(
        err.message,
        {
          ok: false,
          titleSimilarity: 0,
          titleTooSimilar: false,
          bodySimilarity: 0,
          bodyTooSimilar: false,
        },
        0,
        'corpus_load',
      );
    }
    throw err;
  }

  const urlSummary = await resolveSourceContext(input);
  let mainExtraPrompt = options?.mainExtraPrompt;
  let bodyRegenerations = 0;
  let titleRegenerations = 0;
  let result = await generateAllContentOnce(input, { mainExtraPrompt });

  while (true) {
    while (isPostingSimilarityTooHigh(maxPostingTitleSimilarity(result.seo_title, corpus.allTitleEmbeddings))) {
      titleRegenerations++;
      if (titleRegenerations > MAX_POSTING_TITLE_SIMILARITY_ATTEMPTS) {
        const titleSimilarity = maxPostingTitleSimilarity(result.seo_title, corpus.allTitleEmbeddings);
        const titleCheck = checkPostingSimilarity(result.seo_title, result.blog_post, corpus);
        throw new PostingSimilaritySkipError(
          `SEO 제목 유사도 ${titleSimilarity.toFixed(3)} > ${POSTING_SIMILARITY_THRESHOLD} — 제목 재생성 ${MAX_POSTING_TITLE_SIMILARITY_ATTEMPTS}회 후 발행 스킵`,
          titleCheck,
          titleRegenerations,
          'title',
        );
      }

      const titleCheck = checkPostingSimilarity(result.seo_title, result.blog_post, corpus);
      const useHeuristic = titleRegenerations >= POSTING_TITLE_HEURISTIC_FALLBACK_AFTER;
      await logOperation({
        level: 'warn',
        message:
          `[posting-similarity] SEO 제목 재생성 ${titleRegenerations}/${MAX_POSTING_TITLE_SIMILARITY_ATTEMPTS}` +
          `${useHeuristic ? ' (휴리스틱)' : ''} — ` +
          `제목유사도=${titleCheck.titleSimilarity.toFixed(3)} account=${accountId}`,
        workspace: input.workspace,
      });

      result = {
        ...result,
        seo_title: useHeuristic
          ? pickSeoTitleHeuristicFallback(
              input.title,
              input.synopsis,
              result.blog_post,
              titleRegenerations,
            )
          : await regenerateSeoTitleForSimilarity({
              operatorTitle: input.title,
              synopsis: input.synopsis,
              urlSummary,
              blogExcerpt: result.blog_post,
              extraPrompt: buildPostingTitleSimilarityFeedback(titleCheck),
            }),
      };
    }

    let check = checkPostingSimilarity(result.seo_title, result.blog_post, corpus);
    if (check.ok) {
      corpus = await loadPostingSimilarityCorpus(accountId);
      check = checkPostingSimilarity(result.seo_title, result.blog_post, corpus);
      if (check.ok) {
        return {
          ...result,
          similarity_score: Math.max(check.titleSimilarity, check.bodySimilarity),
          similarity_regenerations: titleRegenerations + bodyRegenerations,
        };
      }
      if (check.titleTooSimilar) {
        continue;
      }
      if (check.bodyTooSimilar) {
        throw new PostingSimilaritySkipError(
          `본문 유사도 ${check.bodySimilarity.toFixed(3)} > ${POSTING_SIMILARITY_THRESHOLD} — 최종 검증 실패, 발행 스킵`,
          check,
          bodyRegenerations,
          'body',
        );
      }
    }

    if (check.bodyTooSimilar) {
      if (bodyRegenerations >= MAX_POSTING_BODY_SIMILARITY_RETRIES) {
        throw new PostingSimilaritySkipError(
          `본문 유사도 ${check.bodySimilarity.toFixed(3)} > ${POSTING_SIMILARITY_THRESHOLD} — 재생성 ${MAX_POSTING_BODY_SIMILARITY_RETRIES}회 후 발행 스킵`,
          check,
          bodyRegenerations,
          'body',
        );
      }

      bodyRegenerations++;
      await logOperation({
        level: 'warn',
        message:
          `[posting-similarity] 본문 재생성 ${bodyRegenerations}/${MAX_POSTING_BODY_SIMILARITY_RETRIES} — ` +
          `본문유사도=${check.bodySimilarity.toFixed(3)} account=${accountId}`,
        workspace: input.workspace,
      });

      mainExtraPrompt = buildPostingBodySimilarityFeedback(check);
      result = await generateAllContentOnce(input, { mainExtraPrompt });
      continue;
    }

    if (check.titleTooSimilar) {
      continue;
    }

    throw new PostingSimilaritySkipError(
      `유사도 검사 실패 — 발행 스킵 (제목 ${check.titleSimilarity.toFixed(3)}, 본문 ${check.bodySimilarity.toFixed(3)})`,
      check,
      titleRegenerations + bodyRegenerations,
      'title',
    );
  }
}

/** @deprecated use generateAllContent */
export const generateAutoContent = generateAllContent;
