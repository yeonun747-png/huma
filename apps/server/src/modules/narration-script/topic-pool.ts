import { supabase } from '../../middleware/auth.js';
import { listYeonunProducts, type YeonunProductRow } from '../video-content/yeonun-product-picker.js';
import { listActiveFortune82Products, type Fortune82ProductRow } from './fortune82-product-cache.js';
import type { NarrationScriptWorkspace } from '@huma/shared';

import { deriveNarrationHookLabel } from './topic-hook.js';

export interface NarrationTopic {
  key: string;
  label: string;
  hookLabel: string;
  categoryKey: string | null;
  contextText: string;
}

const YEONUN_CREDIT_PACKAGE_SLUGS = new Set([
  'credit-package-basic',
  'credit-package-popular',
  'credit-package-premium',
]);

export function isYeonunCreditPackageSlug(slug: string): boolean {
  return YEONUN_CREDIT_PACKAGE_SLUGS.has(slug.trim().toLowerCase());
}

function formatYeonunTopic(row: YeonunProductRow): NarrationTopic {
  const tags = Array.isArray(row.tags) ? row.tags.join(', ') : '';
  const label = String(row.title ?? row.slug);
  const hookLabel = deriveNarrationHookLabel(label);
  return {
    key: row.slug,
    label,
    hookLabel,
    categoryKey: row.category_slug ?? null,
    contextText: `[연운 상품]
상품명: ${label}
숏폼 훅(제목·썸네일): ${hookLabel}
slug: ${row.slug}
소개: ${row.quote ?? ''}
카테고리: ${row.category_slug ?? ''}
태그: ${tags}`,
  };
}

function formatFortune82Topic(row: Fortune82ProductRow): NarrationTopic {
  const intro = String(row.intro ?? '').slice(0, 600);
  const composition = String(row.composition ?? '').slice(0, 400);
  const label = row.title;
  const hookLabel = deriveNarrationHookLabel(label);
  return {
    key: row.product_id,
    label,
    hookLabel,
    categoryKey: row.gc != null ? String(row.gc) : null,
    contextText: `[포춘82 상품]
상품명: ${label}
숏폼 훅(제목·썸네일): ${hookLabel}
선생님: ${row.teacher_name ?? ''}
소개: ${intro}
구성: ${composition}
가격: ${row.price ?? ''}원`,
  };
}

export async function listNarrationTopics(workspace: NarrationScriptWorkspace): Promise<NarrationTopic[]> {
  if (workspace === 'fortune82') {
    const rows = await listActiveFortune82Products();
    return rows.map(formatFortune82Topic);
  }
  const rows = await listYeonunProducts();
  return rows.filter((r) => !isYeonunCreditPackageSlug(r.slug)).map(formatYeonunTopic);
}

/** 최근 나레이션 topic_key 사용 횟수 */
export async function getNarrationTopicUsageCounts(
  workspace: NarrationScriptWorkspace,
  limit = 30,
): Promise<Map<string, number>> {
  const { data, error } = await supabase
    .from('huma_narration_script_history')
    .select('topic_key')
    .eq('workspace', workspace)
    .in('status', ['script_ready', 'script_generating'])
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message);

  const counts = new Map<string, number>();
  for (const row of data ?? []) {
    const key = String(row.topic_key ?? '').trim();
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

export function pickWeightedTopic(topics: NarrationTopic[], usage: Map<string, number>): NarrationTopic {
  if (!topics.length) throw new Error('주제 풀이 비어 있습니다');
  let best = topics[0]!;
  let bestWeight = -1;
  for (const topic of topics) {
    const used = usage.get(topic.key) ?? 0;
    const weight = 1 / (1 + used) + Math.random() * 0.05;
    if (weight > bestWeight) {
      bestWeight = weight;
      best = topic;
    }
  }
  return best;
}
