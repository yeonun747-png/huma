import { supabase } from '../../middleware/auth.js';

const FORTUNE_SLUG_RE = /\/fortune\/([^/?#]+)/;

type YeonunCharacterRow = {
  name?: string | null;
  spec?: string | null;
  greeting?: string | null;
};

type YeonunPersonaRow = {
  temperament?: string | null;
  speech_style?: string | null;
  keywords?: string[] | null;
  specialties?: string | null;
};

export type YeonunProductRow = {
  slug: string;
  title: string | null;
  quote: string | null;
  category_slug: string | null;
  tags: string[] | null;
  character_key: string | null;
  characters: YeonunCharacterRow | YeonunCharacterRow[] | null;
  character_personas: YeonunPersonaRow | YeonunPersonaRow[] | null;
};

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function firstRow<T>(row: T | T[] | null | undefined): T | null {
  if (!row) return null;
  return Array.isArray(row) ? (row[0] ?? null) : row;
}

/** /fortune/{slug} — yeonun.com · yeonun.ai 공통 */
export function extractFortuneSlug(sourceUrl: string): string | null {
  const match = sourceUrl.match(FORTUNE_SLUG_RE);
  return match?.[1]?.trim() || null;
}

function formatProductContext(data: YeonunProductRow): string {
  const char = firstRow(data.characters);
  const persona = firstRow(data.character_personas);
  const tags = Array.isArray(data.tags) ? data.tags.join(', ') : '';
  const keywords = Array.isArray(persona?.keywords) ? persona.keywords.join(', ') : '';

  return `[연운 상품 정보]
상품명: ${data.title ?? ''}
소개: ${data.quote ?? ''}
카테고리: ${data.category_slug ?? ''}
태그: ${tags}
캐릭터: ${char?.name ?? ''} (${data.character_key ?? ''})
전문분야: ${char?.spec ?? ''}
인사말: ${char?.greeting ?? ''}
성격/기질: ${persona?.temperament ?? ''}
말투: ${persona?.speech_style ?? ''}
대표 키워드: ${keywords}${persona?.specialties ? `\n특화: ${persona.specialties}` : ''}`;
}

async function fetchProductBySlug(slug: string): Promise<YeonunProductRow | null> {
  const { data, error } = await supabase
    .from('products')
    .select(
      `
      slug,
      title,
      quote,
      category_slug,
      tags,
      character_key,
      characters!products_character_key_fkey (
        name,
        spec,
        greeting
      ),
      character_personas!character_personas_character_key_fkey (
        temperament,
        speech_style,
        keywords,
        specialties
      )
    `,
    )
    .eq('slug', slug)
    .maybeSingle();

  if (error || !data) return null;
  return data as YeonunProductRow;
}

async function fetchPublicPageContext(sourceUrl: string): Promise<string | null> {
  try {
    const res = await fetch(sourceUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; HUMA/1.0)' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    const text = stripHtml(html).slice(0, 3000);
    return text ? `[서비스 페이지 내용]\n${text}` : null;
  } catch {
    return null;
  }
}

async function fetchCharacterModePrompt(characterKey: string): Promise<string | null> {
  const { data: modePrompt } = await supabase
    .from('character_mode_prompts')
    .select('prompt_text')
    .eq('character_key', characterKey)
    .eq('mode', 'fortune_text')
    .maybeSingle();

  const text = modePrompt?.prompt_text?.trim();
  return text || null;
}

/** v3.36 §8-1-1 — fetch 성공 시 HTML, 실패 시 /fortune/{slug} DB JOIN */
export async function buildYeonunContext(sourceUrl: string): Promise<string> {
  const pageCtx = await fetchPublicPageContext(sourceUrl);
  if (pageCtx) return pageCtx;

  const slug = extractFortuneSlug(sourceUrl);
  if (!slug) return '';

  const product = await fetchProductBySlug(slug);
  if (!product) return '';

  return formatProductContext(product);
}

/** 영상 콘티 — slug 기준 풍부한 상품 컨텍스트 (캐릭터·말투 포함) */
export async function buildYeonunProductContextForVideo(slug: string): Promise<string | null> {
  const product = await fetchProductBySlug(slug);
  if (!product) return null;
  return formatProductContext(product);
}

/** 캐릭터 포스팅 톤(character_mode_prompts) 포함 — character_key는 slug가 아님 */
export async function buildYeonunContextWithPrompt(sourceUrl: string): Promise<string> {
  const slug = extractFortuneSlug(sourceUrl);
  const pageCtx = await fetchPublicPageContext(sourceUrl);

  let base = pageCtx ?? '';
  let characterKey: string | null = null;

  if (slug) {
    const product = await fetchProductBySlug(slug);
    if (product) {
      const dbCtx = formatProductContext(product);
      characterKey = product.character_key?.trim() ?? null;
      base = base ? `${dbCtx}\n\n${pageCtx}` : dbCtx;
    }
  }

  if (!characterKey) return base;

  const tonePrompt = await fetchCharacterModePrompt(characterKey);
  if (!tonePrompt) return base;

  return base ? `${base}\n\n[캐릭터 포스팅 톤 지침]\n${tonePrompt}` : `[캐릭터 포스팅 톤 지침]\n${tonePrompt}`;
}
