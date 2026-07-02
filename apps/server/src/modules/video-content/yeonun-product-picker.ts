import { supabase } from '../../middleware/auth.js';
import {
  buildYeonunProductContextForVideo,
  extractFortuneSlug,
  type YeonunProductRow,
} from '../content/yeonun-context.js';
import { filterPostingSubjectCandidates } from '../../lib/posting-recent-subjects.js';
import { logOperation } from '../../lib/log-emitter.js';

export type YeonunProductPick = {
  slug: string;
  title: string | null;
  contextText: string;
};

export type YeonunProductListItem = YeonunProductRow & {
  postingCount: number;
  videoCount: number;
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

/** 포스팅·영상 사용 횟수 — UI 표시·자동 pick 가중치 */
export async function getYeonunProductUsageCounts(): Promise<
  Map<string, { posting: number; video: number }>
> {
  const counts = new Map<string, { posting: number; video: number }>();

  const bump = (slug: string, field: 'posting' | 'video') => {
    const prev = counts.get(slug) ?? { posting: 0, video: 0 };
    prev[field] += 1;
    counts.set(slug, prev);
  };

  const { data: jobs, error: jobsErr } = await supabase
    .from('huma_jobs')
    .select('link_url')
    .eq('workspace', 'yeonun')
    .in('job_type', ['content_full', 'post_blog'])
    .in('status', ['pending', 'scheduled', 'running', 'paused', 'completed'])
    .not('link_url', 'is', null);

  if (jobsErr) throw new Error(jobsErr.message);

  for (const row of jobs ?? []) {
    const slug = extractFortuneSlug(String(row.link_url ?? ''));
    if (slug) bump(slug, 'posting');
  }

  const { data: videos, error: videosErr } = await supabase
    .from('huma_video_content_history')
    .select('used_product')
    .eq('workspace', 'yeonun')
    .not('used_product', 'is', null);

  if (videosErr) throw new Error(videosErr.message);

  for (const row of videos ?? []) {
    const slug = String(row.used_product ?? '').trim();
    if (slug) bump(slug, 'video');
  }

  return counts;
}

export async function listYeonunProductsWithUsage(): Promise<YeonunProductListItem[]> {
  const [products, usage] = await Promise.all([listYeonunProducts(), getYeonunProductUsageCounts()]);
  return products.map((p) => {
    const u = usage.get(p.slug);
    return {
      ...p,
      postingCount: u?.posting ?? 0,
      videoCount: u?.video ?? 0,
    };
  });
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
export async function pickYeonunProduct(opts?: {
  excludeRecentPostingKeys?: Set<string>;
}): Promise<YeonunProductPick | null> {
  const products = await listYeonunProducts();
  if (!products.length) return null;

  const pool = filterPostingSubjectCandidates(
    products,
    (p) => p.slug,
    opts?.excludeRecentPostingKeys ?? new Set(),
  );
  if (pool.length < products.length && opts?.excludeRecentPostingKeys?.size) {
    await logOperation({
      level: 'info',
      message: `[yeonun-pick] 직전 포스팅 제외 후 후보 ${pool.length}/${products.length}건`,
      workspace: 'yeonun',
    });
  }

  const recent = await loadRecentUsedProducts('yeonun');
  const usage = await getYeonunProductUsageCounts();
  const weights = pool.map((p) => {
    const u = usage.get(p.slug);
    const postingN = u?.posting ?? 0;
    const recentVideoN = recent.filter((slug) => slug === p.slug).length;
    return { product: p, weight: 1 / (1 + postingN + recentVideoN) };
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

  const fallback = pool[0]!;
  const contextText =
    (await buildYeonunProductContextForVideo(fallback.slug)) ??
    formatProductContextFallback(fallback);
  return {
    slug: fallback.slug,
    title: fallback.title,
    contextText,
  };
}
