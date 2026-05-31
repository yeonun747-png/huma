import { google } from 'googleapis';

const WORKSPACE_ENV_KEYS: Record<string, string> = {
  quizoasis: 'QUIZOASIS',
};

export interface AdSenseMetricCompare {
  current: number;
  previous: number;
  change: number;
  changePct: number;
}

export interface AdSenseCtrCompare {
  current: number;
  previous: number;
  changePp: number;
  changePct: number;
}

export interface AdSenseStats {
  configured: boolean;
  todayEarnings: number;
  yesterdayEarnings: number;
  monthEarnings: number;
  monthPageViews: number;
  monthClicks: number;
  monthImpressions: number;
  cpc: number;
  ctr: number;
  rpm: number;
  unpaidBalance: number;
  unpaidBalanceFormatted: string;
  combinedTotal: number;
  last7Days: {
    clicks: AdSenseMetricCompare;
    pageViews: AdSenseMetricCompare;
    impressions: AdSenseMetricCompare;
    cpc: AdSenseMetricCompare;
    rpm: AdSenseMetricCompare;
    ctr: AdSenseCtrCompare;
  };
  monthlyTrend: Array<{ month: string; earnings: number; pageViews: number; rpm: number }>;
}

function envKey(workspace: string, suffix: string): string | undefined {
  const ws = WORKSPACE_ENV_KEYS[workspace];
  if (ws) {
    const specific = process.env[`ADSENSE_${suffix}_${ws}`]?.trim();
    if (specific) return specific;
  }
  return (
    process.env[`ADSENSE_${suffix}`]?.trim() ??
    process.env[`GOOGLE_ADSENSE_${suffix}`]?.trim()
  );
}

function getAdSenseClient(workspace: string) {
  const clientId = envKey(workspace, 'CLIENT_ID');
  const clientSecret = envKey(workspace, 'CLIENT_SECRET');
  const refreshToken = envKey(workspace, 'REFRESH_TOKEN');
  if (!clientId || !clientSecret || !refreshToken) return null;

  const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
  oauth2.setCredentials({ refresh_token: refreshToken });
  return google.adsense({ version: 'v2', auth: oauth2 });
}

function accountPath(workspace: string): string | null {
  const raw = envKey(workspace, 'ACCOUNT_ID') ?? envKey(workspace, 'PUBLISHER_ID');
  if (!raw) return null;
  return raw.startsWith('accounts/') ? raw : `accounts/${raw}`;
}

function parseAmount(value: string | null | undefined): number {
  if (!value) return 0;
  const normalized = value.replace(/[^\d.,-]/g, '').replace(/,/g, '');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseMetric(rows: Array<{ cells?: Array<{ value?: string | null }> | null }> | null | undefined, index: number): number {
  let total = 0;
  for (const row of rows ?? []) {
    const val = row.cells?.[index]?.value;
    if (val != null && val !== '') total += Number(val);
  }
  return total;
}

function monthLabel(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

function dateParts(d: Date) {
  return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
}

function daysAgo(days: number): Date {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - days);
  return d;
}

function compareMetric(current: number, previous: number): AdSenseMetricCompare {
  const change = current - previous;
  const changePct = previous > 0 ? (change / previous) * 100 : (current > 0 ? 100 : 0);
  return { current, previous, change, changePct };
}

function emptyCompare(): AdSenseMetricCompare {
  return { current: 0, previous: 0, change: 0, changePct: 0 };
}

function compareCtr(current: number, previous: number): AdSenseCtrCompare {
  return {
    current,
    previous,
    changePp: (current - previous) * 100,
    changePct: previous > 0 ? ((current - previous) / previous) * 100 : (current > 0 ? 100 : 0),
  };
}

function emptyCtrCompare(): AdSenseCtrCompare {
  return { current: 0, previous: 0, changePp: 0, changePct: 0 };
}

function resolveRate(fromApi: number, numerator: number, denominator: number): number {
  if (fromApi > 0) return fromApi;
  return denominator > 0 ? numerator / denominator : 0;
}

async function fetchReport(
  adsense: ReturnType<typeof google.adsense>,
  account: string,
  params: {
    dateRange?: string;
    startDate?: { year: number; month: number; day: number };
    endDate?: { year: number; month: number; day: number };
    metrics: string[];
    dimensions?: string[];
  },
) {
  return adsense.accounts.reports.generate({
    account,
    dateRange: params.dateRange,
    'startDate.year': params.startDate?.year,
    'startDate.month': params.startDate?.month,
    'startDate.day': params.startDate?.day,
    'endDate.year': params.endDate?.year,
    'endDate.month': params.endDate?.month,
    'endDate.day': params.endDate?.day,
    metrics: params.metrics,
    dimensions: params.dimensions,
  });
}

export async function fetchAdSenseStats(workspace: string): Promise<AdSenseStats> {
  const empty: AdSenseStats = {
    configured: false,
    todayEarnings: 0,
    yesterdayEarnings: 0,
    monthEarnings: 0,
    monthPageViews: 0,
    monthClicks: 0,
    monthImpressions: 0,
    cpc: 0,
    ctr: 0,
    rpm: 0,
    unpaidBalance: 0,
    unpaidBalanceFormatted: '',
    combinedTotal: 0,
    last7Days: {
      clicks: emptyCompare(),
      pageViews: emptyCompare(),
      impressions: emptyCompare(),
      cpc: emptyCompare(),
      rpm: emptyCompare(),
      ctr: emptyCtrCompare(),
    },
    monthlyTrend: [],
  };

  const adsense = getAdSenseClient(workspace);
  const account = accountPath(workspace);
  if (!adsense || !account) return empty;

  const now = new Date();

  const trendStart = new Date(now.getFullYear(), now.getMonth() - 2, 1);
  const prev7Start = daysAgo(13);
  const prev7End = daysAgo(7);

  const [todayRes, yesterdayRes, monthRes, trendRes, paymentsRes, last7Res, prev7Res] = await Promise.all([
    fetchReport(adsense, account, {
      dateRange: 'TODAY',
      metrics: ['ESTIMATED_EARNINGS', 'PAGE_VIEWS'],
    }),
    fetchReport(adsense, account, {
      dateRange: 'YESTERDAY',
      metrics: ['ESTIMATED_EARNINGS', 'PAGE_VIEWS'],
    }),
    fetchReport(adsense, account, {
      dateRange: 'MONTH_TO_DATE',
      metrics: ['ESTIMATED_EARNINGS', 'PAGE_VIEWS', 'CLICKS', 'COST_PER_CLICK', 'IMPRESSIONS', 'PAGE_VIEWS_CTR', 'PAGE_VIEWS_RPM'],
    }),
    fetchReport(adsense, account, {
      startDate: { year: trendStart.getFullYear(), month: trendStart.getMonth() + 1, day: 1 },
      endDate: { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() },
      metrics: ['ESTIMATED_EARNINGS', 'PAGE_VIEWS'],
      dimensions: ['MONTH'],
    }),
    adsense.accounts.payments.list({ parent: account }),
    fetchReport(adsense, account, {
      dateRange: 'LAST_7_DAYS',
      metrics: ['ESTIMATED_EARNINGS', 'CLICKS', 'PAGE_VIEWS', 'IMPRESSIONS', 'PAGE_VIEWS_CTR', 'COST_PER_CLICK', 'PAGE_VIEWS_RPM'],
    }),
    fetchReport(adsense, account, {
      startDate: dateParts(prev7Start),
      endDate: dateParts(prev7End),
      metrics: ['ESTIMATED_EARNINGS', 'CLICKS', 'PAGE_VIEWS', 'IMPRESSIONS', 'PAGE_VIEWS_CTR', 'COST_PER_CLICK', 'PAGE_VIEWS_RPM'],
    }),
  ]);

  const todayEarnings = parseMetric(todayRes.data.rows, 0);
  const yesterdayEarnings = parseMetric(yesterdayRes.data.rows, 0);
  const monthEarnings = parseMetric(monthRes.data.rows, 0);
  const monthPageViews = parseMetric(monthRes.data.rows, 1);
  const monthClicks = parseMetric(monthRes.data.rows, 2);
  const cpcFromApi = parseMetric(monthRes.data.rows, 3);
  const monthImpressions = parseMetric(monthRes.data.rows, 4);
  const ctrFromApi = parseMetric(monthRes.data.rows, 5);
  const rpmFromApi = parseMetric(monthRes.data.rows, 6);
  const cpc = cpcFromApi > 0 ? cpcFromApi : (monthClicks > 0 ? monthEarnings / monthClicks : 0);
  const ctr = resolveRate(ctrFromApi, monthClicks, monthPageViews);
  const rpm = rpmFromApi > 0 ? rpmFromApi : (monthPageViews > 0 ? (monthEarnings / monthPageViews) * 1000 : 0);

  const last7Earnings = parseMetric(last7Res.data.rows, 0);
  const last7Clicks = parseMetric(last7Res.data.rows, 1);
  const last7PageViews = parseMetric(last7Res.data.rows, 2);
  const last7Impressions = parseMetric(last7Res.data.rows, 3);
  const last7CtrFromApi = parseMetric(last7Res.data.rows, 4);
  const last7CpcFromApi = parseMetric(last7Res.data.rows, 5);
  const last7RpmFromApi = parseMetric(last7Res.data.rows, 6);
  const prev7Earnings = parseMetric(prev7Res.data.rows, 0);
  const prev7Clicks = parseMetric(prev7Res.data.rows, 1);
  const prev7PageViews = parseMetric(prev7Res.data.rows, 2);
  const prev7Impressions = parseMetric(prev7Res.data.rows, 3);
  const prev7CtrFromApi = parseMetric(prev7Res.data.rows, 4);
  const prev7CpcFromApi = parseMetric(prev7Res.data.rows, 5);
  const prev7RpmFromApi = parseMetric(prev7Res.data.rows, 6);

  const last7Ctr = resolveRate(last7CtrFromApi, last7Clicks, last7PageViews);
  const prev7Ctr = resolveRate(prev7CtrFromApi, prev7Clicks, prev7PageViews);
  const last7Cpc = last7CpcFromApi > 0 ? last7CpcFromApi : (last7Clicks > 0 ? last7Earnings / last7Clicks : 0);
  const prev7Cpc = prev7CpcFromApi > 0 ? prev7CpcFromApi : (prev7Clicks > 0 ? prev7Earnings / prev7Clicks : 0);
  const last7Rpm = last7RpmFromApi > 0 ? last7RpmFromApi : (last7PageViews > 0 ? (last7Earnings / last7PageViews) * 1000 : 0);
  const prev7Rpm = prev7RpmFromApi > 0 ? prev7RpmFromApi : (prev7PageViews > 0 ? (prev7Earnings / prev7PageViews) * 1000 : 0);

  const unpaidPayment = paymentsRes.data.payments?.find((payment) => payment.name?.endsWith('/unpaid'));
  const unpaidBalanceFormatted = unpaidPayment?.amount ?? '';
  const unpaidBalance = parseAmount(unpaidBalanceFormatted);
  const combinedTotal = unpaidBalance + monthEarnings;

  const monthlyTrend: AdSenseStats['monthlyTrend'] = [];
  for (const row of trendRes.data.rows ?? []) {
    const monthRaw = row.cells?.[0]?.value ?? '';
    const earnings = Number(row.cells?.[1]?.value ?? 0);
    const pageViews = Number(row.cells?.[2]?.value ?? 0);
    if (!monthRaw) continue;
    const [y, m] = monthRaw.split('-').map(Number);
    monthlyTrend.push({
      month: monthLabel(y, m),
      earnings,
      pageViews,
      rpm: pageViews > 0 ? (earnings / pageViews) * 1000 : 0,
    });
  }

  return {
    configured: true,
    todayEarnings,
    yesterdayEarnings,
    monthEarnings,
    monthPageViews,
    monthClicks,
    monthImpressions,
    cpc,
    ctr,
    rpm,
    unpaidBalance,
    unpaidBalanceFormatted,
    combinedTotal,
    last7Days: {
      clicks: compareMetric(last7Clicks, prev7Clicks),
      pageViews: compareMetric(last7PageViews, prev7PageViews),
      impressions: compareMetric(last7Impressions, prev7Impressions),
      cpc: compareMetric(last7Cpc, prev7Cpc),
      rpm: compareMetric(last7Rpm, prev7Rpm),
      ctr: compareCtr(last7Ctr, prev7Ctr),
    },
    monthlyTrend,
  };
}

export function isAdSenseConfigured(workspace: string): boolean {
  return Boolean(getAdSenseClient(workspace) && accountPath(workspace));
}
