import { isDashboardPublishListJob } from '@huma/shared';
import type { GscPageRow } from '../modules/seo/search-console.js';

export type ContentPerformanceItem = {
  title: string;
  blogUrl: string;
  landingUrl: string;
  clicks: number;
  impressions: number;
};

export function normalizePageUrl(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    const host = u.hostname.replace(/^www\./i, '').toLowerCase();
    let path = u.pathname.replace(/\/+$/, '') || '/';
    if (path !== '/') path = path.replace(/\/+$/, '');
    return `${host}${path}`;
  } catch {
    return trimmed.toLowerCase().replace(/\/+$/, '');
  }
}

type PublishJob = {
  title?: string | null;
  result_url?: string | null;
  link_url?: string | null;
  completed_at?: string | null;
  workspace?: string | null;
  job_type?: string | null;
  status?: string | null;
  platform_schedule?: unknown;
  content_type?: string | null;
};

function toBlogUrl(raw: string | null | undefined): string {
  const trimmed = raw?.trim() ?? '';
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed.replace(/^\/\//, '')}`;
}

export function buildContentPerformanceItems(
  jobs: PublishJob[],
  gscPagesByWorkspace: Map<string, GscPageRow[]>,
  limit = 5,
): ContentPerformanceItem[] {
  const gscMap = new Map<string, GscPageRow>();
  for (const pages of gscPagesByWorkspace.values()) {
    for (const page of pages) {
      const key = normalizePageUrl(page.page);
      if (key && !gscMap.has(key)) gscMap.set(key, page);
    }
  }

  const items: ContentPerformanceItem[] = [];

  for (const job of jobs) {
    if (!isDashboardPublishListJob(job)) continue;
    const landingKey = normalizePageUrl(job.link_url);
    const gsc = landingKey ? gscMap.get(landingKey) : undefined;

    items.push({
      title: job.title?.trim() || '제목 없음',
      blogUrl: toBlogUrl(job.result_url),
      landingUrl: job.link_url?.trim() ?? '',
      clicks: gsc?.clicks ?? 0,
      impressions: gsc?.impressions ?? 0,
    });
  }

  return items
    .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions)
    .slice(0, limit);
}
