import { google } from 'googleapis';
import { getGoogleOAuth2, gscSiteUrl, googleEnvKey } from '../../lib/google-oauth.js';

export type GscQueryRow = {
  word: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

export function isSearchConsoleConfigured(workspace: string): boolean {
  return Boolean(getGoogleOAuth2(workspace) && gscSiteUrl(workspace));
}

export function getMissingSearchConsoleEnvKeys(workspace: string): string[] {
  const missing: string[] = [];
  if (!googleEnvKey(workspace, 'CLIENT_ID')) missing.push('GSC/ADSENSE CLIENT_ID');
  if (!googleEnvKey(workspace, 'CLIENT_SECRET')) missing.push('GSC/ADSENSE CLIENT_SECRET');
  if (!googleEnvKey(workspace, 'REFRESH_TOKEN')) missing.push('GSC/ADSENSE REFRESH_TOKEN');
  if (!gscSiteUrl(workspace)) missing.push(`GSC_SITE_URL (${workspace})`);
  return missing;
}

export async function fetchSearchConsoleTopQueries(
  workspace: string,
  rowLimit = 10,
): Promise<GscQueryRow[]> {
  const auth = getGoogleOAuth2(workspace);
  const siteUrl = gscSiteUrl(workspace);
  if (!auth || !siteUrl) return [];

  const sc = google.searchconsole({ version: 'v1', auth });
  const end = new Date();
  const start = new Date(end.getTime() - 28 * 86400000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  const res = await sc.searchanalytics.query({
    siteUrl,
    requestBody: {
      startDate: fmt(start),
      endDate: fmt(end),
      dimensions: ['query'],
      rowLimit,
      dataState: 'final',
    },
  });

  return (res.data.rows ?? []).map((row) => ({
    word: String(row.keys?.[0] ?? ''),
    clicks: row.clicks ?? 0,
    impressions: row.impressions ?? 0,
    ctr: row.ctr ?? 0,
    position: row.position ?? 0,
  }));
}
