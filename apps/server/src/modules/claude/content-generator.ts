import { askClaudeWithModel } from '../../lib/anthropic-client.js';
import { getMainClaudeModel, getSubClaudeModel } from '../../lib/ai-engine.js';
import {
  withHumanWritingMandate,
  withHumanWritingSystem,
  withLongformWritingMandate,
} from '../../lib/ai-human-writing.js';
import { formatKstWritingContext } from '../../lib/dashboard-period.js';
import { buildYeonunContextWithPrompt } from '../content/yeonun-context.js';
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
${workspaceServiceMentionRuleLine('quizoasis')}`,
  panana: `당신은 파나나(PANANA) AI 캐릭터 콘텐츠 플랫폼의 콘텐츠 마케터입니다.
톤: 시네마틱하고 감성적인 짧은 문체.
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
  const t = s.trim().replace(/\s+/g, ' ');
  if (t.length <= SEO_TITLE_MAX) return t;
  const cut = t.slice(0, SEO_TITLE_MAX);
  const lastSpace = cut.lastIndexOf(' ');
  if (lastSpace > SEO_TITLE_MAX * 0.6) return cut.slice(0, lastSpace);
  return cut;
}

function isAcceptableSeoTitle(seo: string | undefined, operatorTitle: string): boolean {
  const t = seo?.trim();
  if (!t) return false;
  if (t.length > SEO_TITLE_MAX) return false;
  if (normalizeTitleCompare(t) === normalizeTitleCompare(operatorTitle)) return false;
  return true;
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
  return truncateSeoTitle(`${operatorTitle.slice(0, 28)}·정리`);
}

async function generateSeoTitleOnly(params: {
  operatorTitle: string;
  synopsis?: string;
  urlSummary: string;
  blogExcerpt?: string;
}): Promise<string | undefined> {
  const synopsisBlock = params.synopsis?.trim()
    ? `[운영자 시놉시스 — 반드시 반영]\n${params.synopsis.trim()}`
    : '[시놉시스 없음]';

  const raw = await askClaudeWithModel({
    model: (await getSubClaudeModel()) || HAIKU_MODEL_FALLBACK,
    max_tokens: 120,
    prompt: `네이버 블로그 검색 노출용 SEO 제목만 생성 (JSON만).

운영자 입력 제목(참고용·그대로 쓰지 말 것): ${params.operatorTitle}
${synopsisBlock}
[URL·주제 요약]
${params.urlSummary.slice(0, 400)}
${params.blogExcerpt ? `[생성된 본문 앞부분]\n${params.blogExcerpt.slice(0, 300)}` : ''}

규칙:
- 32자 이내 (공백 포함, 초과 금지)
- 핵심 검색 키워드를 앞쪽 배치
- 운영자 제목과 동일·거의 동일하게 쓰지 말 것
- 과장·특수문자 남발 금지
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
}): Promise<string> {
  const operatorTitle = params.operatorTitle.trim();
  if (isAcceptableSeoTitle(params.candidate, operatorTitle)) {
    return truncateSeoTitle(params.candidate!.trim());
  }

  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const generated = await generateSeoTitleOnly(params);
      if (isAcceptableSeoTitle(generated, operatorTitle)) {
        return truncateSeoTitle(generated!.trim());
      }
    } catch (err) {
      console.warn('[content-generator] seo_title 전용 생성 실패:', (err as Error).message);
    }
  }

  return forceDistinctSeoTitle(operatorTitle, params.synopsis, params.blogExcerpt);
}

export function resolvePostingTitle(generated: Pick<ContentGenerationOutput, 'seo_title'>): string {
  return generated.seo_title.trim();
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
      `${resolveWorkspaceServiceMention(input.workspace).withDomain.trim()}에서 확인`,
    ].join('\n'),
    input.workspace,
  );
  const short = `${input.title}. ${(input.synopsis ?? urlSummary).slice(0, 80).trim()}`;
  const wsTag = input.workspace === 'quizoasis' ? '#심리테스트' : input.workspace === 'panana' ? '#AI캐릭터' : '#사주';
  return {
    blog_post: body,
    seo_title: forceDistinctSeoTitle(input.title, input.synopsis, body),
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
): Promise<Omit<ContentGenerationOutput, 'hashtags'>> {
  const lengthGuide = blogPostLengthPromptGuide(lengthRange);
  const { min, max } = lengthRange;
  const writingNow = formatKstWritingContext();
  const sourceUrl = input.sourceUrl?.trim() || '(없음)';
  const synopsisGuide = input.synopsis
    ? `\n[운영자 시놉시스 - 반드시 참고]\n"${input.synopsis}"`
    : '\n[시놉시스 없음 — 아래 참조 URL·URL 요약을 반드시 반영해 작성]';

  const datetimeGuide = `\n[현재 시각 — 글은 이 순간에 실제 발행되는 것처럼 작성]
${writingNow}
「지금·이번 달·오늘」 관점으로 쓸 것. 과거 회고(저번달에 봤었는데)도 현재 시각 기준 자연스럽게 허용. 날짜·시각을 본문에 그대로 밝히 쓸 필요는 없음.`;

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
  "seo_title": "네이버 검색 최적화 제목 32자 이내. 핵심 키워드를 앞쪽에 배치, 클릭 유도. 과장·특수문자 남발 금지",
  "blog_post": "네이버 블로그 글 ${min}~${max}자 (필수·중간 끊김 금지·완결된 글). ${serviceMentionGuide.replace(/\n/g, ' ')}",
  "tiktok_caption": "TikTok 캡션 150자 이내",
  "instagram_caption": "Instagram 캡션 300자 이내",
  "threads_text": "Threads 텍스트 500자 이내, 링크 포함",
  "x_text": "X 텍스트 280자 이내, 링크 포함",
  "image_prompt": "Imagen 4 영문. 주제 상징 중심 still life/scene — 돈·재물 강조 시 coins/gold/wallet, 사랑·재회 시 hearts/cherry blossom/warm pink, 직장·사업 시 office/success symbols. 사람이 폰·화면 보며 사주 보는 장면 금지. 텍스트·로고·워터마크 없음. 9:16 cinematic",
  "video_prompt": "Kling 3.0 9:16 영상 프롬프트 (영문, 내장 오디오)"
}`),
    },
  ];

  const model = (await getMainClaudeModel()) || SONNET_MODEL_FALLBACK;
  const system = withHumanWritingSystem(SYSTEM_PROMPTS[input.workspace] ?? SYSTEM_PROMPTS.yeonun);

  const callOnce = async (extra?: string) => {
    const content = extra
      ? [...userParts, { type: 'text', text: extra }]
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

  if (input.workspace === 'yeonun') {
    const yeonunCtx = await buildYeonunContextWithPrompt(url);
    if (yeonunCtx.trim()) blocks.push(yeonunCtx);
  }

  const fetched = await fetchAndSummarizeUrl(url);
  if (fetched.trim() && !/^URL:\s*$/i.test(fetched)) {
    blocks.push(
      fetched.startsWith('URL:')
        ? `[URL fetch 실패 — 주소만 참고]\n${fetched}\n(가능하면 yeonun 상품 DB·페이지 구조를 추론)`
        : `[URL 페이지 요약]\n${fetched}`,
    );
  } else if (blocks.length === 1) {
    blocks.push(`[URL fetch 실패] ${url} — 제목·시놉시스·스크린샷(있으면)을 최대한 활용`);
  }

  return blocks.join('\n\n');
}

/** 기획서 7-0 generateAllContent */
export async function generateAllContent(input: ContentGenerationInput): Promise<ContentGenerationOutput> {
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
    const mainContent = await generateMainContent(input, urlSummary, lengthRange);
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
          `제목: ${input.title}
${input.synopsis?.trim() ? `[운영자 시놉시스 - 반드시 참고]\n"${input.synopsis.trim()}"` : '[시놉시스 없음 — URL 요약 반영]'}
URL 요약: ${urlSummary.slice(0, 500)}
${blogPostLengthPromptGuide(lengthRange)}

[서비스 언급 규칙]
${workspaceServiceMentionPromptGuide(input.workspace)}

네이버 블로그용 ${lengthRange.min}~${lengthRange.max}자 완결 본문과 SEO 제목·SNS 캡션을 JSON으로 (tts_script 생략, Kling 내장 오디오):
{"seo_title":"네이버 검색 최적화 제목 32자 이내. 핵심 키워드 앞배치, 운영자 제목과 다르게","blog_post":"...","tiktok_caption":"...","instagram_caption":"...","threads_text":"...","x_text":"...","image_prompt":"...","video_prompt":"..."}`,
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

/** @deprecated use generateAllContent */
export const generateAutoContent = generateAllContent;
