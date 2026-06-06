import { askClaudeWithModel } from '../../lib/anthropic-client.js';
import { getMainClaudeModel, getSubClaudeModel } from '../../lib/ai-engine.js';
import { withHumanWritingMandate, withHumanWritingSystem } from '../../lib/ai-human-writing.js';
import { buildYeonunContextWithPrompt } from '../content/yeonun-context.js';
import {
  blogPostLengthPromptGuide,
  pickBlogPostLengthRange,
  type BlogPostLengthRange,
  type BlogPostLengthTier,
} from '../../lib/blog-post-length.js';

export interface ContentGenerationInput {
  title: string;
  sourceUrl: string;
  synopsis?: string;
  screenshotBase64?: string;
  workspace: string;
  content_type?: 'A' | 'B';
  /** 계정별 블로그 문체 지침 (연운 ~요체 등) */
  blogWritingPersona?: string;
}

export interface ContentGenerationOutput {
  blog_post: string;
  tiktok_caption: string;
  instagram_caption: string;
  threads_text: string;
  x_text: string;
  image_prompt: string;
  video_prompt: string;
  /** v3.26: 비우면 Kling 3.0 내장 오디오 (TTS 미사용) */
  tts_script?: string;
  hashtags: string[];
  /** 이번 생성 목표 분량 tier (500|700|900 = 상한 구간) */
  blog_post_target_chars?: BlogPostLengthTier;
  blog_post_target_min_chars?: number;
}

const SONNET_MODEL_FALLBACK = 'claude-sonnet-4-6';
const HAIKU_MODEL_FALLBACK = 'claude-haiku-4-5-20251001';

const SYSTEM_PROMPTS: Record<string, string> = {
  yeonun: `당신은 연운(緣運) 네이버 블로그에 글을 쓰는 30대 한국인 독자입니다. 마케터·AI가 아닙니다.
톤: ~요체, 가볍고 친근, 친구에게 카톡하듯. 경험담·솔직한 감정·짧은 추임새(ㅎㅎ, ㅠㅠ)를 적절히.
금지: AI/마케팅 문체 — 「정리했습니다」「안내합니다」「살펴보겠습니다」「흐름과 실천 포인트를 정리」 같은 표현.
필수: 입력에 [말투]·[캐릭터 포스팅 톤 지침]·character_mode_prompts가 있으면 그 말투를 본문에 그대로 반영.
서비스 URL은 본문에 yeonun.com 도메인만 1~2회 자연스럽게 (전체 경로·https 금지).`,
  quizoasis: `당신은 퀴즈오아시스 글로벌 심리테스트 플랫폼의 콘텐츠 마케터입니다.
톤: 재미있고 공유 욕구를 자극하는 가벼운 문체. 테스트 링크 포함.`,
  panana: `당신은 파나나(PANANA) AI 캐릭터 콘텐츠 플랫폼의 콘텐츠 마케터입니다.
톤: 시네마틱하고 감성적인 짧은 문체. 서비스 링크 포함.`,
};

function finalizeBlogPost(text: string): string {
  return sanitizeBlogLinksInPost(text.trim());
}

function sanitizeBlogLinksInPost(text: string): string {
  return text
    .replace(/https?:\/\/(www\.)?yeonun\.com[^\s\n]*/gi, 'yeonun.com')
    .replace(/www\.yeonun\.com/gi, 'yeonun.com');
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

function parseScreenshotBase64(raw: string): { mediaType: 'image/jpeg' | 'image/png'; data: string } {
  const match = raw.match(/^data:(image\/(?:jpeg|png));base64,(.+)$/i);
  if (match) {
    return {
      mediaType: match[1].toLowerCase() === 'image/jpeg' ? 'image/jpeg' : 'image/png',
      data: match[2],
    };
  }
  const data = raw.replace(/^data:image\/\w+;base64,/, '');
  return { mediaType: data.startsWith('/9j/') ? 'image/jpeg' : 'image/png', data };
}

function fallbackContent(
  input: ContentGenerationInput,
  urlSummary: string,
  lengthRange: BlogPostLengthRange,
): ContentGenerationOutput {
  const intro = input.synopsis?.trim() || input.title.trim();
  const summaryLen = lengthRange.tier <= 500 ? 220 : lengthRange.tier <= 700 ? 320 : 400;
  const body = finalizeBlogPost(
    [
      intro,
      '',
      urlSummary.slice(0, summaryLen),
      '',
      'yeonun.com 에서 확인',
    ].join('\n'),
  );
  const short = `${input.title}. ${(input.synopsis ?? urlSummary).slice(0, 80).trim()}`;
  const wsTag = input.workspace === 'quizoasis' ? '#심리테스트' : input.workspace === 'panana' ? '#AI캐릭터' : '#사주';
  return {
    blog_post: body,
    blog_post_target_chars: lengthRange.tier,
    blog_post_target_min_chars: lengthRange.min,
    tiktok_caption: short.slice(0, 150),
    instagram_caption: short.slice(0, 300),
    threads_text: `${short}\n\n${input.sourceUrl}`,
    x_text: `${short.slice(0, 220)} ${input.sourceUrl}`.slice(0, 280),
    image_prompt: `Cinematic vertical 9:16 image about ${input.title}, moody lighting, high detail`,
    video_prompt: `Cinematic 9:16 vertical video about ${input.title}, smooth camera motion`,
    hashtags: [wsTag, '#AI', '#콘텐츠'],
  };
}

async function generateMainContent(
  input: ContentGenerationInput,
  urlSummary: string,
  lengthRange: BlogPostLengthRange,
): Promise<Omit<ContentGenerationOutput, 'hashtags'>> {
  const lengthGuide = blogPostLengthPromptGuide(lengthRange);
  const { min, max } = lengthRange;
  const synopsisGuide = input.synopsis
    ? `\n[운영자 시놉시스 - 반드시 참고]\n"${input.synopsis}"`
    : '\n[시놉시스 없음 - URL과 제목을 바탕으로 자율 작성]';

  const typeGuide =
    input.content_type === 'A'
      ? '\n콘텐츠 타입 A: 텍스트+이미지 중심. video_prompt는 짧게.'
      : '\n콘텐츠 타입 B: 텍스트+이미지+영상. video_prompt를 풍부하게. 오디오는 Kling 3.0 내장 — tts_script 필드 생략.';

  const personaGuide = input.blogWritingPersona?.trim()
    ? `\n[계정 블로그 문체 — 반드시 준수]\n${input.blogWritingPersona.trim()}`
    : input.workspace === 'yeonun'
      ? '\n[블로그 문체] ~요체·경험담·AI 티 금지. speech_style·캐릭터 톤 지침을 본문 말투에 반영.'
      : '';

  const userParts: Array<Record<string, unknown>> = [
    {
      type: 'text',
      text: withHumanWritingMandate(`URL 핵심:\n${urlSummary}\n\n제목: ${input.title}${synopsisGuide}${personaGuide}${typeGuide}\n${lengthGuide}\n\n순수 JSON만 (코드블록 없이):
{
  "blog_post": "네이버 블로그 글 ${min}~${max}자 (필수·중간 끊김 금지·완결된 글, ~요체·경험담·사람 말투). 본문 URL은 yeonun.com 만",
  "tiktok_caption": "TikTok 캡션 150자 이내",
  "instagram_caption": "Instagram 캡션 300자 이내",
  "threads_text": "Threads 텍스트 500자 이내, 링크 포함",
  "x_text": "X 텍스트 280자 이내, 링크 포함",
  "image_prompt": "Imagen 4 영문. 주제 상징 중심 still life/scene — 돈·재물 강조 시 coins/gold/wallet, 사랑·재회 시 hearts/cherry blossom/warm pink, 직장·사업 시 office/success symbols. 사람이 폰·화면 보며 사주 보는 장면 금지. 텍스트·로고·워터마크 없음. 9:16 cinematic",
  "video_prompt": "Kling 3.0 9:16 영상 프롬프트 (영문, 내장 오디오)"
}`),
    },
  ];

  if (input.screenshotBase64) {
    const { mediaType, data } = parseScreenshotBase64(input.screenshotBase64);
    userParts.unshift({ type: 'text', text: '서비스 화면 캡처 (UI·특징 반영):' });
    userParts.unshift({
      type: 'image',
      source: { type: 'base64', media_type: mediaType, data },
    });
  }

  const raw = await askClaudeWithModel({
    model: (await getMainClaudeModel()) || SONNET_MODEL_FALLBACK,
    max_tokens: 4096,
    system: withHumanWritingSystem(SYSTEM_PROMPTS[input.workspace] ?? SYSTEM_PROMPTS.yeonun),
    content: userParts,
  });

  if (!raw) throw new Error('Claude Sonnet 응답 없음');

  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  const parsed = JSON.parse(jsonMatch?.[0] ?? raw) as Omit<ContentGenerationOutput, 'hashtags'>;
  if (!parsed.blog_post) throw new Error('블로그 본문 생성 실패');
  parsed.blog_post = finalizeBlogPost(parsed.blog_post);
  parsed.blog_post_target_chars = lengthRange.tier;
  parsed.blog_post_target_min_chars = lengthRange.min;
  return parsed;
}

async function generateSubContent(
  title: string,
  urlSummary: string,
  workspace: string,
): Promise<{ hashtags: string[] }> {
  const raw = await askClaudeWithModel({
    model: (await getSubClaudeModel()) || HAIKU_MODEL_FALLBACK,
    max_tokens: 300,
    prompt: `서비스: ${workspace}, 제목: ${title}
내용 요약: ${urlSummary.slice(0, 500)}

JSON만 (코드블록 없이):
{"hashtags":["태그1", "...최대 20개"]}`,
  });

  if (!raw) return { hashtags: ['#AI', '#콘텐츠'] };

  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch?.[0] ?? raw) as { hashtags?: string[] };
    return {
      hashtags: parsed.hashtags?.length ? parsed.hashtags : ['#AI', '#콘텐츠'],
    };
  } catch {
    return { hashtags: ['#AI', '#콘텐츠'] };
  }
}

async function resolveSourceContext(input: ContentGenerationInput): Promise<string> {
  if (input.workspace === 'yeonun') {
    const yeonunCtx = await buildYeonunContextWithPrompt(input.sourceUrl.trim());
    if (yeonunCtx.trim()) return yeonunCtx;
  }
  return fetchAndSummarizeUrl(input.sourceUrl);
}

/** 기획서 7-0 generateAllContent */
export async function generateAllContent(input: ContentGenerationInput): Promise<ContentGenerationOutput> {
  const urlSummary = await resolveSourceContext(input);
  const lengthRange = pickBlogPostLengthRange();

  try {
    const [mainContent, subContent] = await Promise.all([
      generateMainContent(input, urlSummary, lengthRange),
      generateSubContent(input.title, urlSummary, input.workspace),
    ]);
    return { ...mainContent, ...subContent };
  } catch (mainErr) {
    if (!process.env.ANTHROPIC_API_KEY) {
      return fallbackContent(input, urlSummary, lengthRange);
    }
    try {
      const retryRaw = await askClaudeWithModel({
        model: (await getSubClaudeModel()) || HAIKU_MODEL_FALLBACK,
        max_tokens: 2000,
        system: withHumanWritingSystem(SYSTEM_PROMPTS[input.workspace] ?? SYSTEM_PROMPTS.yeonun),
        prompt: withHumanWritingMandate(
          `제목: ${input.title}\nURL 요약: ${urlSummary.slice(0, 500)}\n${blogPostLengthPromptGuide(lengthRange)}\n\n네이버 블로그용 ${lengthRange.min}~${lengthRange.max}자 완결 본문과 TikTok/Instagram/Threads/X용 짧은 캡션을 JSON으로 (tts_script 생략, Kling 내장 오디오):\n{"blog_post":"...","tiktok_caption":"...","instagram_caption":"...","threads_text":"...","x_text":"...","image_prompt":"...","video_prompt":"..."}`,
        ),
      });
      const jsonMatch = retryRaw?.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as Omit<ContentGenerationOutput, 'hashtags'>;
        const sub = await generateSubContent(input.title, urlSummary, input.workspace);
        if (parsed.blog_post) {
          parsed.blog_post = finalizeBlogPost(parsed.blog_post);
          parsed.blog_post_target_chars = lengthRange.tier;
          parsed.blog_post_target_min_chars = lengthRange.min;
          return { ...parsed, ...sub };
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
