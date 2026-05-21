import { askClaudeWithModel } from '../../lib/anthropic-client.js';

export interface ContentGenerationInput {
  title: string;
  sourceUrl: string;
  synopsis?: string;
  screenshotBase64?: string;
  workspace: string;
  content_type?: 'A' | 'B';
}

export interface ContentGenerationOutput {
  blog_post: string;
  tiktok_caption: string;
  instagram_caption: string;
  threads_text: string;
  x_text: string;
  image_prompt: string;
  video_prompt: string;
  tts_script: string;
  hashtags: string[];
  bgm_mood: string;
}

const SONNET_MODEL = 'claude-sonnet-4-20250514';
const HAIKU_MODEL = 'claude-haiku-4-5-20251001';

const SYSTEM_PROMPTS: Record<string, string> = {
  yeonun: `당신은 연운(緣運) AI 사주·운세 플랫폼의 전문 콘텐츠 마케터입니다.
톤: 신비롭고 따뜻한 동양적 감성. 서비스 URL을 2~3회 자연스럽게 포함.`,
  quizoasis: `당신은 퀴즈오아시스 글로벌 심리테스트 플랫폼의 콘텐츠 마케터입니다.
톤: 재미있고 공유 욕구를 자극하는 가벼운 문체. 테스트 링크 포함.`,
  panana: `당신은 파나나(PANANA) AI 캐릭터 콘텐츠 플랫폼의 콘텐츠 마케터입니다.
톤: 시네마틱하고 감성적인 짧은 문체. 서비스 링크 포함.`,
};

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
    model: HAIKU_MODEL,
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

function fallbackContent(input: ContentGenerationInput, urlSummary: string): ContentGenerationOutput {
  const body = input.synopsis
    ? `${input.title}\n\n${input.synopsis}\n\n${urlSummary}\n\n원문: ${input.sourceUrl}`
    : `${input.title}\n\n${urlSummary}\n\n원문: ${input.sourceUrl}`;
  const short = `${input.title}. ${input.synopsis?.slice(0, 80) ?? urlSummary.slice(0, 80)}`;
  return {
    blog_post: body,
    tiktok_caption: short.slice(0, 150),
    instagram_caption: short.slice(0, 300),
    threads_text: `${short}\n\n${input.sourceUrl}`,
    x_text: `${short.slice(0, 220)} ${input.sourceUrl}`.slice(0, 280),
    image_prompt: `Cinematic vertical 9:16 image about ${input.title}, moody lighting, high detail`,
    video_prompt: `Cinematic 9:16 vertical video about ${input.title}, smooth camera motion`,
    tts_script: short,
    hashtags: ['#운세', '#AI', '#콘텐츠'],
    bgm_mood: 'calm',
  };
}

async function generateMainContent(
  input: ContentGenerationInput,
  urlSummary: string,
): Promise<Omit<ContentGenerationOutput, 'hashtags' | 'bgm_mood'>> {
  const synopsisGuide = input.synopsis
    ? `\n[운영자 시놉시스 - 반드시 참고]\n"${input.synopsis}"`
    : '\n[시놉시스 없음 - URL과 제목을 바탕으로 자율 작성]';

  const typeGuide =
    input.content_type === 'A'
      ? '\n콘텐츠 타입 A: 텍스트+이미지 중심. video_prompt·tts_script는 짧게 작성해도 됨.'
      : '\n콘텐츠 타입 B: 텍스트+이미지+영상. video_prompt·tts_script를 풍부하게 작성.';

  const userParts: Array<Record<string, unknown>> = [
    {
      type: 'text',
      text: `URL 핵심:\n${urlSummary}\n\n제목: ${input.title}${synopsisGuide}${typeGuide}\n\n순수 JSON만 (코드블록 없이):
{
  "blog_post": "네이버 블로그 글 2000자 이상",
  "tiktok_caption": "TikTok 캡션 150자 이내",
  "instagram_caption": "Instagram 캡션 300자 이내",
  "threads_text": "Threads 텍스트 500자 이내, 링크 포함",
  "x_text": "X 텍스트 280자 이내, 링크 포함",
  "image_prompt": "Higgsfield 이미지 프롬프트 (영문)",
  "video_prompt": "Higgsfield 9:16 영상 프롬프트 (영문)",
  "tts_script": "TTS 나레이션 30~60초 한국어"
}`,
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
    model: SONNET_MODEL,
    max_tokens: 4096,
    system: SYSTEM_PROMPTS[input.workspace] ?? SYSTEM_PROMPTS.yeonun,
    content: userParts,
  });

  if (!raw) throw new Error('Claude Sonnet 응답 없음');

  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  const parsed = JSON.parse(jsonMatch?.[0] ?? raw) as Omit<ContentGenerationOutput, 'hashtags' | 'bgm_mood'>;
  if (!parsed.blog_post) throw new Error('블로그 본문 생성 실패');
  return parsed;
}

async function generateSubContent(
  title: string,
  urlSummary: string,
  workspace: string,
): Promise<{ hashtags: string[]; bgm_mood: string }> {
  const raw = await askClaudeWithModel({
    model: HAIKU_MODEL,
    max_tokens: 300,
    prompt: `서비스: ${workspace}, 제목: ${title}
내용 요약: ${urlSummary.slice(0, 500)}

JSON만 (코드블록 없이):
{"hashtags":["태그1", "...최대 20개"],"bgm_mood":"calm/romantic/mysterious/energetic/dramatic/emotional/playful/inspiring 중 1개"}`,
  });

  if (!raw) return { hashtags: ['#AI', '#콘텐츠'], bgm_mood: 'calm' };

  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch?.[0] ?? raw) as { hashtags?: string[]; bgm_mood?: string };
    return {
      hashtags: parsed.hashtags?.length ? parsed.hashtags : ['#AI', '#콘텐츠'],
      bgm_mood: parsed.bgm_mood ?? 'calm',
    };
  } catch {
    return { hashtags: ['#AI', '#콘텐츠'], bgm_mood: 'calm' };
  }
}

/** 기획서 7-0 generateAllContent */
export async function generateAllContent(input: ContentGenerationInput): Promise<ContentGenerationOutput> {
  const urlSummary = await fetchAndSummarizeUrl(input.sourceUrl);

  try {
    const [mainContent, subContent] = await Promise.all([
      generateMainContent(input, urlSummary),
      generateSubContent(input.title, urlSummary, input.workspace),
    ]);
    return { ...mainContent, ...subContent };
  } catch {
    return fallbackContent(input, urlSummary);
  }
}

/** @deprecated use generateAllContent */
export const generateAutoContent = generateAllContent;
