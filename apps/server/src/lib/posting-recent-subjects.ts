import { supabase } from '../middleware/auth.js';
import { extractFortuneSlug } from '../modules/content/yeonun-context.js';
import { extractQuizTestSlug } from '../modules/content/quizoasis-context.js';
import { extractPananaCharacterKey } from '../modules/content/panana-context.js';

/** 포스팅 자동 선택 — 직전 N건에 쓴 상품/주제 제외 */
export const POSTING_RECENT_SUBJECT_EXCLUDE = 5;

const POSTING_SUBJECT_WORKSPACES = new Set(['yeonun', 'quizoasis', 'panana']);

const ACTIVE_POSTING_JOB_STATUSES = [
  'pending',
  'scheduled',
  'running',
  'paused',
  'completed',
] as const;

export function extractPostingSubjectKey(workspace: string, linkUrl: string | null | undefined): string | null {
  const url = linkUrl?.trim();
  if (!url) return null;
  if (workspace === 'yeonun') return extractFortuneSlug(url);
  if (workspace === 'quizoasis') return extractQuizTestSlug(url);
  if (workspace === 'panana') return extractPananaCharacterKey(url);
  return null;
}

/** 직전 포스팅 N건 link_url에서 subject key (중복 포함) */
export async function loadRecentPostingSubjectKeys(
  workspace: string,
  limit = POSTING_RECENT_SUBJECT_EXCLUDE,
): Promise<Set<string>> {
  if (!POSTING_SUBJECT_WORKSPACES.has(workspace)) return new Set();

  const { data, error } = await supabase
    .from('huma_jobs')
    .select('link_url')
    .eq('workspace', workspace)
    .in('job_type', ['content_full', 'post_blog'])
    .in('status', [...ACTIVE_POSTING_JOB_STATUSES])
    .not('link_url', 'is', null)
    .order('created_at', { ascending: false })
    .limit(Math.max(limit * 4, 20));

  if (error) throw new Error(error.message);

  const keys = new Set<string>();
  let jobsCounted = 0;
  for (const row of data ?? []) {
    if (jobsCounted >= limit) break;
    jobsCounted += 1;
    const key = extractPostingSubjectKey(workspace, row.link_url as string | null);
    if (key) keys.add(key);
  }
  return keys;
}

/** 직전 N건에 등장한 subject — 후보 풀에서 제외 (전부 제외 시 원본 유지) */
export function filterPostingSubjectCandidates<T>(
  items: T[],
  keyFn: (item: T) => string,
  recentKeys: Set<string>,
): T[] {
  if (!recentKeys.size || !items.length) return items;
  const filtered = items.filter((item) => !recentKeys.has(keyFn(item)));
  return filtered.length > 0 ? filtered : items;
}
