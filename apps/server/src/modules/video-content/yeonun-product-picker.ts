import { supabase } from '../../middleware/auth.js';
import {
  buildYeonunProductContextForVideo,
  type YeonunProductRow,
} from '../content/yeonun-context.js';

export type YeonunProductPick = {
  slug: string;
  title: string | null;
  contextText: string;
};

function formatProductContextFallback(data: YeonunProductRow): string {
  const tags = Array.isArray(data.tags) ? data.tags.join(', ') : '';
  return `[연운 상품]
상품명: ${data.title ?? data.slug}
slug: ${data.slug}
소개: ${data.quote ?? ''}
카테고리: ${data.category_slug ?? ''}
태그: ${tags}`;
}

export async function listYeonunProducts(): Promise<YeonunProductRow[]> {
  const { data, error } = await supabase
    .from('products')
    .select('slug, title, quote, category_slug, tags, character_key')
    .order('slug');

  if (error) throw new Error(error.message);
  return (data ?? []) as YeonunProductRow[];
}

async function loadRecentUsedProducts(workspace: string, limit = 20): Promise<string[]> {
  const { data } = await supabase
    .from('huma_video_content_history')
    .select('used_product')
    .eq('workspace', workspace)
    .not('used_product', 'is', null)
    .order('created_at', { ascending: false })
    .limit(limit);

  return (data ?? []).map((r) => String(r.used_product ?? '')).filter(Boolean);
}

/** 등장 횟수가 적을수록 선택 확률 ↑ */
export async function pickYeonunProduct(): Promise<YeonunProductPick | null> {
  const products = await listYeonunProducts();
  if (!products.length) return null;

  const recent = await loadRecentUsedProducts('yeonun');
  const counts = new Map<string, number>();
  for (const slug of recent) {
    counts.set(slug, (counts.get(slug) ?? 0) + 1);
  }

  const weights = products.map((p) => {
    const count = counts.get(p.slug) ?? 0;
    return { product: p, weight: 1 / (1 + count) };
  });

  const total = weights.reduce((s, w) => s + w.weight, 0);
  let r = Math.random() * total;
  for (const entry of weights) {
    r -= entry.weight;
    if (r <= 0) {
      const contextText =
        (await buildYeonunProductContextForVideo(entry.product.slug)) ??
        formatProductContextFallback(entry.product);
      return {
        slug: entry.product.slug,
        title: entry.product.title,
        contextText,
      };
    }
  }

  const fallback = products[0]!;
  const contextText =
    (await buildYeonunProductContextForVideo(fallback.slug)) ??
    formatProductContextFallback(fallback);
  return {
    slug: fallback.slug,
    title: fallback.title,
    contextText,
  };
}
