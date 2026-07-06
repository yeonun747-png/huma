import type { Workspace } from '@huma/shared';
import { askClaudeWithModel } from '../../lib/anthropic-client.js';
import { callClaudeJsonWithRetry } from '../../lib/llm-json.js';
import { getMainClaudeModel } from '../../lib/ai-engine.js';
import { SERVICE_URLS, type PlatformCaptions, type VideoConti } from './types.js';

const YOUTUBE_TITLE_MAX_LEN = 100;
const TIKTOK_CAPTION_MAX_LEN = 4000;
const INSTAGRAM_CAPTION_MAX_LEN = 2200;
/** 기존 3~5개 → 4배 */
const TIKTOK_HASHTAG_MIN = 10;
const TIKTOK_HASHTAG_TARGET = 16;
const INSTAGRAM_HASHTAG_MIN = 10;
const INSTAGRAM_HASHTAG_TARGET = 16;

/** 틱톡·인스타 — 검색·브랜드용 한국어 태그만 (fyp·viral 등 영어 범용 태그 제외) */
const WORKSPACE_TIKTOK_KO_TAGS: Record<Workspace, string[]> = {
  yeonun: [
    '#연운', '#커리어운세', '#오늘의운세', '#사주', '#직장운', '#운세추천', '#신입직장인', '#직장인공감',
    '#협상', '#계약', '#운세앱', '#일간', '#사주팔자', '#운세풀이', '#직장인브이로그', '#직장생활',
    '#오피스브이로그', '#사회초년생', '#운세', '#오늘운세', '#연애운', '#재물운', '#타로', '#별자리',
    '#궁합', '#운명', '#인생조언', '#연애조언', '#건강운', '#월별운세', '#띠별운세', '#신년운세',
    '#명리', '#팔자', '#올해운세', '#직장운세', '#커리어조언',
  ],
  quizoasis: [
    '#퀴즈오아시스', '#QuizOasis', '#심리테스트', '#성격테스트', '#성격유형', '#MBTI', '#연애유형',
    '#유형테스트', '#재미퀴즈', '#심리분석', '#연애테스트', '#직장유형', '#성향테스트', '#자아탐구',
    '#성격분석', '#연애심리', '#직장심리', '#심리퀴즈', '#테스트추천', '#오늘의퀴즈', '#성격유형테스트',
    '#연애성향', '#MBTI테스트', '#심리상담', '#자기이해', '#관계테스트', '#커플테스트',
  ],
  panana: [
    '#파나나', '#panana', '#심리테스트', '#성격테스트', '#MBTI', '#연애테스트', '#AI캐릭터',
    '#감성테스트', '#연애유형', '#성격유형', '#자아탐구', '#심리분석', '#연애심리', '#성향테스트',
    '#캐릭터테스트', '#감정테스트', '#관계테스트', '#커플테스트', '#성격분석', '#오늘의테스트',
    '#재미테스트', '#심리퀴즈', '#연애성향', '#자기이해',
  ],
};

const WORKSPACE_INSTAGRAM_KO_TAGS: Record<Workspace, string[]> = {
  yeonun: [
    '#연운', '#커리어운세', '#오늘의운세', '#사주', '#직장운', '#운세추천', '#신입직장인', '#직장인공감',
    '#협상', '#계약', '#운세앱', '#일간', '#사주팔자', '#운세풀이', '#직장인릴스', '#직장생활',
    '#오피스브이로그', '#사회초년생', '#운세', '#오늘운세', '#연애운', '#재물운', '#타로', '#별자리',
    '#궁합', '#운명', '#인생조언', '#건강운', '#월별운세', '#띠별운세', '#신년운세', '#명리', '#팔자',
    '#올해운세', '#릴스추천', '#직장운세',
  ],
  quizoasis: [
    '#퀴즈오아시스', '#QuizOasis', '#심리테스트', '#성격테스트', '#성격유형', '#MBTI', '#연애유형',
    '#유형테스트', '#재미퀴즈', '#심리분석', '#연애테스트', '#성향테스트', '#릴스추천', '#테스트추천',
    '#오늘의퀴즈', '#성격유형테스트', '#연애성향', '#MBTI테스트', '#자기이해', '#관계테스트',
  ],
  panana: [
    '#파나나', '#panana', '#심리테스트', '#성격테스트', '#MBTI', '#연애테스트', '#AI캐릭터',
    '#감성테스트', '#연애유형', '#릴스추천', '#성향테스트', '#캐릭터테스트', '#관계테스트',
    '#성격분석', '#심리퀴즈', '#연애성향',
  ],
};

/** 숏폼에서 제외할 범용 영어·무의미 태그 */
const SHORTS_HASHTAG_BLOCKLIST = new Set([
  'fyp', 'foryou', 'foryoupage', 'viral', 'trending', 'tiktok', 'tiktokkorea', 'kpop', 'korean',
  'korea', 'love', 'life', 'couple', 'daily', 'storytime', 'relatable', 'mustwatch', 'fortune',
  'dailyhoroscope', 'tarot', 'horoscope', 'reels', 'reelsinstagram', 'instagram', 'explore',
  'explorepage', 'instagood', 'shortvideo', 'trend', 'funny', 'quiz', 'quiztime', 'viralquiz',
  'psychology', 'personality', 'personalitytest', 'funquiz', 'test',
]);

const ALLOWED_ENGLISH_BRAND_TAGS = new Set([
  'quizoasis', 'panana', 'mbti', 'yeonun',
]);

const KO_DIALOGUE_FRAGMENT = /[\uAC00-\uD7A3](이|가|을|를|은|는|에|의|고|다|며|면|서|니|야|요|죠|네|라|게|지|하|했|던|면서|이라|이니|으니)$/;

/** #Shorts·쇼츠 — 형식 태그는 검색 SEO에 무의미하므로 제목·태그에서 제거 */
export function sanitizeYoutubeShortsTitle(title: string): string {
  return title
    .replace(/#Shorts\b/gi, '')
    .replace(/#쇼츠\b/gi, '')
    .replace(/\bShorts\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function filterShortsHashtags(hashtags: string[]): string[] {
  return hashtags.filter((h) => {
    const bare = h.replace(/^#/, '').trim().toLowerCase();
    return bare !== 'shorts' && bare !== '쇼츠';
  });
}

const WORKSPACE_YOUTUBE_DEFAULT_TAGS: Record<Workspace, string> = {
  yeonun: '#연운 #운세 #사주 #오늘운세 #운세풀이 #연애운 #재물운',
  quizoasis: '#QuizOasis #퀴즈 #심리테스트 #성격테스트 #성격유형 #quiz #테스트',
  panana: '#파나나 #panana #퀴즈 #심리테스트 #성격테스트 #MBTI #연애테스트',
};

const WORKSPACE_YOUTUBE_EXTRA_TAGS: Record<Workspace, string[]> = {
  yeonun: [
    '#타로', '#별자리', '#궁합', '#fortune', '#dailyhoroscope', '#korea',
    '#운명', '#인생조언', '#연애조언', '#직장운', '#건강운', '#월별운세',
    '#띠별운세', '#신년운세', '#명리', '#팔자', '#올해운세', '#fyp', '#viral',
  ],
  quizoasis: [
    '#personality', '#funquiz', '#viral', '#fyp', '#shortvideo', '#korea',
    '#연애유형', '#성격분석', '#유형테스트', '#재미', '#trend', '#foryou',
    '#mbti', '#psychology', '#quiztime', '#dailyquiz', '#funtest', '#viralquiz',
  ],
  panana: [
    '#personality', '#funtest', '#viral', '#fyp', '#shortvideo', '#korea',
    '#연애유형', '#성격분석', '#유형테스트', '#재미', '#trend', '#foryou',
    '#mbti', '#psychology', '#quiztime', '#dailyquiz', '#lovequiz', '#viralquiz',
  ],
};

function isBlockedShortsTag(tag: string): boolean {
  const bare = tag.replace(/^#/, '').trim().toLowerCase();
  return bare === 'shorts' || bare === '쇼츠';
}

export function isMeaningfulShortsHashtag(tag: string): boolean {
  const bare = tag.replace(/^#/, '').trim();
  if (!bare || bare.length < 2 || isBlockedShortsTag(bare)) return false;
  const lower = bare.toLowerCase();
  if (SHORTS_HASHTAG_BLOCKLIST.has(lower)) return false;
  if (ALLOWED_ENGLISH_BRAND_TAGS.has(lower)) return true;
  if (/^[a-z0-9_]+$/i.test(bare)) return false;
  if (/[\uAC00-\uD7A3]/.test(bare)) {
    if (bare.length <= 1) return false;
    if (bare.length <= 6 && KO_DIALOGUE_FRAGMENT.test(bare)) return false;
    return true;
  }
  return false;
}

export function filterMeaningfulShortsHashtags(hashtags: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const tag of hashtags) {
    const normalized = normalizeHashtagToken(tag);
    if (!normalized || !isMeaningfulShortsHashtag(normalized)) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
}

function normalizeHashtagToken(tag: string, shortsOnly = false): string | null {
  const bare = tag.replace(/^#/, '').trim();
  if (!bare || isBlockedShortsTag(bare)) return null;
  const normalized = `#${bare}`;
  if (shortsOnly && !isMeaningfulShortsHashtag(normalized)) return null;
  return normalized;
}

/** 제목 본문 + 해시태그 풀 — 100자 한도까지 태그 우선 채움 */
export function packYoutubeShortsTitle(
  raw: string,
  extraTags: string[] = [],
  maxLen = YOUTUBE_TITLE_MAX_LEN,
): string {
  const cleaned = sanitizeYoutubeShortsTitle(raw);
  const tokens = cleaned.split(/\s+/).filter(Boolean);
  const headlineParts: string[] = [];
  const tagOrder: string[] = [];
  const seen = new Set<string>();

  const pushTag = (tag: string) => {
    const normalized = normalizeHashtagToken(tag);
    if (!normalized) return;
    const key = normalized.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    tagOrder.push(normalized);
  };

  for (const t of tokens) {
    if (t.startsWith('#')) pushTag(t);
    else headlineParts.push(t);
  }
  for (const t of extraTags) pushTag(t);

  let headline = headlineParts.join(' ').trim();
  if (headline.length > 32) headline = headline.slice(0, 32).trim();

  let result = headline;
  for (const tag of tagOrder) {
    const candidate = result ? `${result} ${tag}` : tag;
    if (candidate.length <= maxLen) result = candidate;
  }

  return result.trim().slice(0, maxLen);
}

function buildWorkspaceHashtagPool(
  workspace: Workspace,
  conti?: VideoConti,
  hookType?: string,
  platform: 'youtube' | 'tiktok' | 'instagram' = 'youtube',
): string[] {
  const pool: string[] = [];
  for (const t of WORKSPACE_YOUTUBE_DEFAULT_TAGS[workspace].split(/\s+/)) {
    if (t) pool.push(t);
  }

  if (platform === 'youtube') {
    for (const t of WORKSPACE_YOUTUBE_EXTRA_TAGS[workspace] ?? []) pool.push(t);
    if (conti) {
      const summary = (conti.scenarioSummary ?? conti.fullText ?? '').trim();
      const words = summary
        .replace(/[^\uAC00-\uD7A3a-zA-Z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length >= 3 && w.length <= 10);
      for (const w of words.slice(0, 8)) pool.push(`#${w.replace(/\s+/g, '')}`);
    }
    if (hookType?.trim()) {
      pool.push(`#${hookType.trim().replace(/\s+/g, '')}`);
    }
    return pool;
  }

  const curated =
    platform === 'tiktok'
      ? WORKSPACE_TIKTOK_KO_TAGS[workspace]
      : WORKSPACE_INSTAGRAM_KO_TAGS[workspace];
  for (const t of curated) pool.push(t);
  return filterMeaningfulShortsHashtags(pool);
}

function buildYoutubeHashtagPool(
  workspace: Workspace,
  conti?: VideoConti,
  hookType?: string,
): string[] {
  return buildWorkspaceHashtagPool(workspace, conti, hookType, 'youtube');
}

function buildTiktokHashtagPool(
  workspace: Workspace,
  conti?: VideoConti,
  hookType?: string,
): string[] {
  return buildWorkspaceHashtagPool(workspace, conti, hookType, 'tiktok');
}

function buildInstagramHashtagPool(
  workspace: Workspace,
  conti?: VideoConti,
  hookType?: string,
): string[] {
  return buildWorkspaceHashtagPool(workspace, conti, hookType, 'instagram');
}

/** 숏폼 SNS — 본문(1~2줄) + 해시태그 풀을 maxLen까지 채움 */
function packSocialCaption(
  raw: string,
  extraTags: string[] = [],
  maxLen: number,
): string {
  const withoutUrl = raw.replace(/https?:\/\/\S+/g, '').trim();
  const tokens = withoutUrl.split(/\s+/).filter(Boolean);
  const bodyParts: string[] = [];
  const tagOrder: string[] = [];
  const seen = new Set<string>();

  const pushTag = (tag: string) => {
    const normalized = normalizeHashtagToken(tag, true);
    if (!normalized) return;
    const key = normalized.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    tagOrder.push(normalized);
  };

  for (const t of tokens) {
    if (t.startsWith('#')) pushTag(t);
    else bodyParts.push(t);
  }
  for (const t of extraTags) pushTag(t);

  let body = bodyParts.join(' ').trim();
  if (body.length > 280) body = body.slice(0, 280).trim();

  let tagBlock = '';
  for (const tag of tagOrder) {
    const candidate = tagBlock ? `${tagBlock} ${tag}` : tag;
    const withBody = body ? `${body}\n\n${candidate}` : candidate;
    if (withBody.length <= maxLen) tagBlock = candidate;
  }

  if (!body && !tagBlock) return '';
  if (!tagBlock) return body.slice(0, maxLen);
  if (!body) return tagBlock.slice(0, maxLen);
  return `${body}\n\n${tagBlock}`.trim().slice(0, maxLen);
}

/** 틱톡 — 본문(1~2줄) + 해시태그 풀을 4000자까지 채움 */
export function packTiktokCaption(
  raw: string,
  extraTags: string[] = [],
  maxLen = TIKTOK_CAPTION_MAX_LEN,
): string {
  return packSocialCaption(raw, extraTags, maxLen);
}

/** 인스타그램 — 본문(1~2줄) + 해시태그 풀을 2200자까지 채움 */
export function packInstagramCaption(
  raw: string,
  extraTags: string[] = [],
  maxLen = INSTAGRAM_CAPTION_MAX_LEN,
): string {
  return packSocialCaption(raw, extraTags, maxLen);
}

function countHashtagsInText(text: string): number {
  return (text.match(/#[^\s#]+/g) ?? []).length;
}

function finalizeSocialCaption(
  raw: string,
  pool: string[],
  maxLen: number,
  minTags: number,
): string {
  let packed = packSocialCaption(raw, pool, maxLen);
  if (countHashtagsInText(packed) < minTags) {
    packed = packSocialCaption(packed.split('\n\n')[0] ?? raw, pool, maxLen);
  }
  return packed;
}

function finalizeTiktokCaption(
  raw: string,
  workspace: Workspace,
  conti?: VideoConti,
  hookType?: string,
): string {
  return finalizeSocialCaption(
    raw,
    buildTiktokHashtagPool(workspace, conti, hookType),
    TIKTOK_CAPTION_MAX_LEN,
    TIKTOK_HASHTAG_MIN,
  );
}

function finalizeInstagramCaption(
  raw: string,
  workspace: Workspace,
  conti?: VideoConti,
  hookType?: string,
): string {
  return finalizeSocialCaption(
    raw,
    buildInstagramHashtagPool(workspace, conti, hookType),
    INSTAGRAM_CAPTION_MAX_LEN,
    INSTAGRAM_HASHTAG_MIN,
  );
}

function finalizeYoutubeTitle(
  raw: string,
  workspace: Workspace,
  conti?: VideoConti,
  hookType?: string,
): string {
  return packYoutubeShortsTitle(raw, buildYoutubeHashtagPool(workspace, conti, hookType));
}

function normalizePlatformCaptions(
  parsed: Record<string, unknown>,
  workspace: Workspace,
  conti?: VideoConti,
  hookType?: string,
): PlatformCaptions {
  const text = (key: string) => String(parsed[key] ?? '').trim();
  const nullable = (key: string): string | null => {
    const v = parsed[key];
    if (v == null || v === 'null') return null;
    const s = String(v).trim();
    return s || null;
  };

  let captionYoutubeTitle = text('captionYoutubeTitle') || text('youtubeTitle');
  let captionYoutubeDescription = text('captionYoutubeDescription') || text('youtubeDescription');
  if (!captionYoutubeTitle && !captionYoutubeDescription) {
    const legacy = text('captionYoutube');
    if (legacy) captionYoutubeDescription = legacy;
  }

  return {
    captionYoutubeTitle: finalizeYoutubeTitle(captionYoutubeTitle, workspace, conti, hookType),
    captionYoutubeDescription: captionYoutubeDescription
      .replace(/#Shorts\b/gi, '')
      .replace(/#쇼츠\b/gi, '')
      .replace(/\s{2,}/g, ' ')
      .trim(),
    captionTiktok: finalizeTiktokCaption(text('captionTiktok'), workspace, conti, hookType),
    captionInstagram: finalizeInstagramCaption(text('captionInstagram'), workspace, conti, hookType),
    captionThreads: text('captionThreads'),
    captionX: text('captionX'),
    firstCommentThreads: nullable('firstCommentThreads'),
    firstCommentX: nullable('firstCommentX'),
  };
}

export function fallbackPlatformCaptions(workspace: Workspace, conti: VideoConti): PlatformCaptions {
  const summary = (conti.scenarioSummary ?? conti.fullText ?? '숏폼 영상').trim().slice(0, 280);
  const url = SERVICE_URLS[workspace];
  const linkComment = url ? `👉 ${url}` : null;
  const headline = summary.slice(0, 32).trim();
  const tagPool = buildYoutubeHashtagPool(workspace, conti);
  const body = summary.slice(0, 200).trim();
  const profileCta = '프로필 링크에서 더 보기 👆';
  return {
    captionYoutubeTitle: packYoutubeShortsTitle(headline, tagPool),
    captionYoutubeDescription: url ? `${summary}\n\n${url}` : summary,
    captionTiktok: finalizeTiktokCaption(`${body}\n${profileCta}`, workspace, conti),
    captionInstagram: finalizeInstagramCaption(`${body}\n${profileCta}`, workspace, conti),
    captionThreads: summary,
    captionX: summary,
    firstCommentThreads: linkComment,
    firstCommentX: linkComment,
  };
}

export async function generatePlatformCaptions(params: {
  workspace: Workspace;
  conti: VideoConti;
  hookType: string;
  recentCaptions?: string[];
}): Promise<PlatformCaptions> {
  const serviceUrl = SERVICE_URLS[params.workspace];
  const recentBlock =
    params.recentCaptions?.length ?
      `\n직전 캡션 (표현 겹치지 말 것):\n${params.recentCaptions.join('\n---\n')}\n`
    : '';

  const model = (await getMainClaudeModel()) || 'claude-sonnet-4-6';
  const prompt = `아래 영상 콘티를 바탕으로 5개 플랫폼용 캡션을 JSON으로 작성.

콘티 요약: ${params.conti.scenarioSummary}
펀치라인 유형: ${params.hookType}
서비스 URL: ${serviceUrl}
${recentBlock}

플랫폼별 규칙:
- youtube (YouTube Shorts — 제목·설명 입력란이 분리됨):
  - captionYoutubeTitle: 「제목」 입력란 — 짧은 제목(25~40자) + 콘티·퀴즈 검색용 해시태그 **8~15개**, 공백 포함 **95~100자에 최대한 가깝게** (100자 hard limit, URL·긴 설명 금지)
  - 해시태그는 시청자 검색·브랜드·콘티 키워드만 (yeonun→#연운 #사주 #운세…, panana→#파나나 #심리테스트…, quizoasis→#QuizOasis #성격테스트… + 콘티 장면 키워드)
  - #Shorts #쇼츠 Shorts 등 플랫폼·영상 형식 태그 절대 금지
  - captionYoutubeDescription: 「설명」 입력란 — 2~4줄 긴 설명 + 서비스 URL (해시태그·#Shorts 금지)
- tiktok (최대 4000자): 1~2줄 본문 + 프로필 링크 유도(매번 다른 표현) + 해시태그 **${TIKTOK_HASHTAG_MIN}~${TIKTOK_HASHTAG_TARGET}개** — **한국어 검색·브랜드·주제 태그만** (#연운 #직장운 #사주 등). fyp·viral·tiktok·storytime 등 영어 범용 태그·대사 조각(#지은이 #한다고 등) 절대 금지. URL 본문 금지
- instagram (최대 2200자): 1~2줄 본문 + 프로필 링크 유도(매번 다른 표현) + 해시태그 **${INSTAGRAM_HASHTAG_MIN}~${INSTAGRAM_HASHTAG_TARGET}개** — tiktok과 동일(한국어 의미 태그만, 영어 범용·대사 조각 금지). URL 본문 금지
- threads: 1~2줄 + "첫 댓글에 링크" 유도, firstCommentThreads에 URL 포함 댓글
- x: 1~2줄 + firstCommentX에 URL 포함 댓글 (첫 댓글 유도 방식)

JSON 문자열 값 안의 큰따옴표(")는 반드시 \\" 로 이스케이프하거나 「」 따옴표를 쓴다.

JSON:
{
  "captionYoutubeTitle": "짧은 제목 #연운 #사주 #오늘운세 #연애운 #재물운 #운세풀이 #korea",
  "captionYoutubeDescription": "2~4줄 설명\\n\\n${serviceUrl}",
  "captionTiktok": "...",
  "captionInstagram": "...",
  "captionThreads": "...",
  "captionX": "...",
  "firstCommentThreads": "URL 포함 댓글 또는 null",
  "firstCommentX": "URL 포함 댓글 또는 null"
}`;

  const { parsed } = await callClaudeJsonWithRetry<Record<string, unknown>>({
    model,
    max_tokens: 4096,
    prompt,
    ask: (p) => askClaudeWithModel(p),
  });
  return normalizePlatformCaptions(parsed, params.workspace, params.conti, params.hookType);
}
